import React, { useCallback } from 'react';
import { BigNumber } from 'bignumber.js';
import ConfirmTransactionModal from 'components/Modals/components/ConfirmTransactionModal';
import PendingModal from 'components/Modals/components/PendingModal';
import ApproveTokensModal from 'components/Modals/components/ApproveTokensModal';
import RequestFailedModal from 'components/Modals/components/RequestFailedModal';
import TransactionCompletedModal from 'components/Modals/components/TransactionCompletedModal';
import TransactionFailedModal from 'components/Modals/components/TransactionFailedModal';
import { useWeb3React } from '@web3-react/core';

import { useChain } from 'context/chain/ChainContext';
import { BondingCont, NOMCont } from 'context/chain/contracts';
import { useExchange, useUpdateExchange } from 'context/exchange/ExchangeContext';
import {
  ExchangeItem,
  Sending,
  Receiving,
  ExchangeInput,
  MaxBtn,
  ReceivingValue,
  ExchangeButton,
} from './exchangeStyles';
import { useModal } from 'context/modal/ModalContext';
import NOMButton from 'components/Exchange/NOMButton';
import { format18, parse18 } from 'utils/math';
import _, { debouce } from 'lodash';

export default function ExchangeQuote({ strength }) {
  const { strongBalance, weakBalance } = useChain();
  const { handleModal } = useModal();
  const { library } = useWeb3React();

  const bondContract = BondingCont(library);
  const NOMcontract = NOMCont(library);

  const { askAmount, bidAmount, approveAmount, bidDenom, input, output, strong, weak } = useExchange();
  const { NOMallowance } = useChain();
  const { objDispatch, strDispatch } = useUpdateExchange();

  const getAskAmount = useCallback(
    async (askAmountState, bidAmountUpdate, textStrength) => {
      var askAmountUpdate = askAmountState;

      switch (textStrength) {
        case 'strong':
          console.log('Strong: ', bidAmountUpdate.toFixed(0));
          askAmountUpdate = await bondContract.buyQuoteETH(bidAmountUpdate.toFixed(0));
          console.log('Pull Strong Ask Amount', askAmountUpdate);
          break;

        case 'weak':
          askAmountUpdate = await bondContract.sellQuoteNOM(bidAmountUpdate.toFixed(0));
          console.log('Pull Weak Ask Amount', askAmountUpdate);
          break;

        default:
          console.error('Denom not set');
      }
      return new BigNumber(askAmountUpdate.toString());
    },
    [bondContract],
  );

  const onApprove = async () => {
    if (weakBalance.gte(bidAmount)) {
      if (bidAmount.gt(NOMallowance)) {
        handleModal(<ApproveTokensModal onConfirmApprove={onConfirmApprove} />);
      } else {
        handleModal(<ConfirmTransactionModal submitTrans={submitTrans} />);
      }
    } else {
      handleModal(<TransactionFailedModal error={`${weak} Balance too low`} />);
    }
  };

  const onConfirmApprove = () => {
    try {
      handleModal(<ConfirmTransactionModal isApproving submitTrans={submitTrans} />);
    } catch (e) {
      handleModal(<TransactionFailedModal error={e.code + '\n' + e.message.slice(0, 80) + '...'} />);
    }
  };

  const submitTrans = useCallback(
    async (isApproving, slippage, gasPrice) => {
      handleModal(<PendingModal isApproving={isApproving} />);

      if (isApproving) {
        if (!approveAmount) return;
        try {
          let tx = await NOMcontract.increaseAllowance(bondContract.address, approveAmount.toString(), {
            gasPrice: gasPrice.toFixed(0),
          });

          tx.wait().then(() => {
            handleModal(<TransactionCompletedModal isApproving tx={tx} />);
          });
        } catch (e) {
          console.log(e);
          handleModal(<TransactionFailedModal error={e.code + '\n' + e.message.slice(0, 80) + '...'} />);
        }
      } else {
        if (!bidAmount || !askAmount) return;
        try {
          let tx;
          let gasFee;

          switch (bidDenom) {
            case 'strong':
              // Preparing for many tokens / coins
              switch (strong) {
                case 'ETH':
                  const gasFeeRaw = await bondContract.estimateGas.buyNOM(askAmount.toFixed(0), slippage.toFixed(0), {
                    value: bidAmount.toFixed(0),
                  });

                  gasFee = new BigNumber(gasFeeRaw.toString());

                  const bidAmountUpdate = bidAmount.minus(gasFee.times(gasPrice));
                  const askAmountUpdateRaw = await bondContract.buyQuoteETH(bidAmountUpdate.toFixed(0));
                  const askAmountUpdate = new BigNumber(askAmountUpdateRaw.toString());

                  tx = await bondContract.buyNOM(askAmountUpdate.toFixed(0), slippage.toFixed(0), {
                    value: bidAmountUpdate.toFixed(0),
                    gasPrice: gasPrice.toFixed(0),
                    gasLimit: gasFee.toFixed(0),
                  });

                  tx.wait().then(() => {
                    handleModal(<TransactionCompletedModal tx={tx} />);
                  });

                  break;
                default: {
                }
              }
              break;

            case 'weak':
              switch (weak) {
                case 'wNOM':
                  tx = await bondContract.sellNOM(bidAmount.toFixed(0), askAmount.toFixed(0), slippage.toFixed(0), {
                    gasPrice: gasPrice.toFixed(0),
                  });

                  tx.wait().then(() => {
                    handleModal(<TransactionCompletedModal tx={tx} />);
                  });
                  break;
                default: {
                }
              }
              break;

            default:
              console.log();
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(e.code, e.message.message);
          // alert(e.message)
          handleModal(<TransactionFailedModal error={e.code + '\n' + e.message.slice(0, 80) + '...'} />);
        }
      }
    },
    [askAmount, bidAmount, approveAmount, bidDenom, NOMcontract, bondContract, handleModal, strong, weak],
  );

  const onBid = () => {
    switch (true) {
      case bidDenom !== strength:
        handleModal(<RequestFailedModal error="Please enter amount" />);
        break;
      case strength === 'strong' && strongBalance.gte(bidAmount):
        handleModal(<ConfirmTransactionModal submitTrans={submitTrans} />);
        break;
      case strength === 'weak' && weakBalance.gte(bidAmount):
        handleModal(<ConfirmTransactionModal submitTrans={submitTrans} />);
        break;
      default:
        handleModal(<RequestFailedModal error="Insufficient funds" />);
    }
  };

  const onMax = async () => {
    let strUpdate = new Map();
    strUpdate.set('bidDenom', strength);
    let bidMaxValue = strength === 'strong' ? strongBalance : weakBalance;

    strUpdate.set('input', format18(bidMaxValue).toString());

    let askAmountUpdate;

    try {
      console.log('calling here:', askAmount, bidMaxValue, strength);
      askAmountUpdate = await getAskAmount(askAmount, bidMaxValue, strength);
    } catch (err) {
      if (err) {
        handleModal(<RequestFailedModal error={err.error.message} />);
      }
    }

    let objUpdate = new Map();

    objUpdate = objUpdate.set('askAmount', askAmountUpdate);

    objUpdate = objUpdate.set('bidAmount', bidMaxValue);

    objDispatch({
      type: 'update',
      value: objUpdate,
    });

    strUpdate.set('output', format18(new BigNumber(askAmountUpdate.toString())).toFixed(8));

    strDispatch({
      type: 'update',
      value: strUpdate,
    });
  };

  var text_strength = 'weak';
  var evt_target_value = '';

  var debounced = _.debounce(async () => {
    let strUpdate = new Map();
    switch (true) {
      case bidDenom === strength && input === evt_target_value.toString():
        break;
      case evt_target_value === '':
        {
          let objUpdate = new Map();

          objUpdate = objUpdate.set('askAmount', new BigNumber(0));

          objUpdate = objUpdate.set('bidAmount', new BigNumber(0));

          objDispatch({
            type: 'update',
            value: objUpdate,
          });
        }

        strUpdate = strUpdate.set('input', '');

        strUpdate = strUpdate.set('output', '');

        strDispatch({
          type: 'update',
          value: strUpdate,
        });

        break;
      case Number(evt_target_value) > 0 && parseFloat(evt_target_value) > 0:
        const bidAmountUpdate = parse18(new BigNumber(parseFloat(evt_target_value).toString()));
        const inputUpdate = evt_target_value.toString();

        if (bidDenom !== strength) {
          strUpdate = strUpdate.set('bidDenom', strength);
        }

        var askAmountUpdate;

        try {
          askAmountUpdate = await getAskAmount(askAmount, bidAmountUpdate, text_strength);
        } catch (err) {
          if (err) {
            console.log(err.error.message);
            handleModal(<RequestFailedModal error={err.error.message} />);
          }
          break;
        }

        let objUpdate = new Map();

        objUpdate = objUpdate.set('askAmount', new BigNumber(askAmountUpdate.toString()));

        objUpdate = objUpdate.set('bidAmount', bidAmountUpdate);

        objDispatch({
          type: 'update',
          value: objUpdate,
        });

        strUpdate = strUpdate.set('output', format18(new BigNumber(askAmountUpdate.toString())).toFixed(8));
        strDispatch({
          type: 'update',
          value: strUpdate,
        });
        break;
      default:
        handleModal(<RequestFailedModal error="Please enter numbers only. Thank you!" />);
    }
  }, 500);

  const onTextChange = useCallback(
    async (evt, textStrength) => {
      evt.preventDefault();
      {
        strDispatch({
          type: 'update',
          value: new Map().set('input', evt.target.value.toString()),
        });
      }
      evt_target_value = evt.target.value;
      text_strength = textStrength;
      debounced.call();
    },
    [askAmount, bidDenom, getAskAmount, handleModal, input, objDispatch, strDispatch, strength],
  );

  return (
    <ExchangeItem>
      <strong>Bid {strength === 'strong' ? strong : weak}</strong>
      <Sending>
        <strong>I'm bidding</strong>
        <ExchangeInput
          type="text"
          data-testid="exchange-strong-balance-input"
          onChange={evt => onTextChange(evt, strength)}
          value={bidDenom === strength ? input : ''}
          placeholder="0.00"
        />
        {strength === 'strong' ? strong : weak}
        <MaxBtn data-testid="max-value-button" onClick={() => onMax()}>
          Max
        </MaxBtn>
      </Sending>
      <Receiving>
        <strong>I'm asking</strong>
        <ReceivingValue data-testid="exchange-weak-balance">
          {strength === bidDenom ? output : ''} {strength === 'strong' ? weak : strong}
        </ReceivingValue>
      </Receiving>
      {strength === 'strong' ? (
        bidDenom === 'weak' ? (
          <ExchangeButton>Input Value</ExchangeButton>
        ) : bidAmount.lte(strongBalance) ? (
          input === '' ? (
            <ExchangeButton>Input Value</ExchangeButton>
          ) : (
            <ExchangeButton onClick={onBid}>Buy {strength === 'strong' ? weak : strong}</ExchangeButton>
          )
        ) : (
          <ExchangeButton>Low {strong} Balance</ExchangeButton>
        )
      ) : (
        <NOMButton onBid={onBid} onApprove={onApprove} />
      )}
    </ExchangeItem>
  );
}
