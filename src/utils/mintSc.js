import { addReq, getWalletAddress } from './helpers';
import { Address } from '@coinbarn/ergo-ts';
import { follow, p2s } from './assembler';
import { dollarToCent, ergToNano } from './serializer';
import { forceUpdateState, mintScTx, priceToMintSc, scTokenId } from './ageHelper';
import moment from 'moment';
import { ergSendPrecision, minErgVal, usdAcronym, usdName } from './consts';

const template = `{
  val properMinting = {
    val myOut = OUTPUTS(1)
    myOut.propositionBytes == fromBase64("$userAddress") &&
      myOut.tokens(0)._1 == fromBase64("$scTokenId") &&
      myOut.tokens(0)._2 == $scAmountL && HEIGHT < $timestampL &&
      CONTEXT.dataInputs(0).id == fromBase64("$oracleBoxId")
  }
  val returnFunds = {
    val total = INPUTS.fold(0L, {(x:Long, b:Box) => x + b.value}) - 4000000
    OUTPUTS(0).value >= total && OUTPUTS(0).propositionBytes == fromBase64("$userAddress")
  }
  sigmaProp(properMinting || returnFunds)
}`;

export async function mintSc(amount) {
    await forceUpdateState()

    let ourAddr = getWalletAddress();
    let befPrice = await priceToMintSc(amount) + 1000000
    let price = (befPrice / 1e9).toFixed(ergSendPrecision)
    price = ergToNano(price)
    if (price < befPrice) price += 10 ** (9 - ergSendPrecision)
    let tx = await mintScTx(amount)
    for (let i = 0; i < tx.requests.length; i++) {
        if (tx.requests[i].value < minErgVal) throw new Error("Too little value!")
    }
    tx.requests[1].value += (price - befPrice)

    let addr = (await getScMintP2s(amount, tx.dataInputs[0])).address
    let request = {
        address: addr,
        returnTo: ourAddr,
        startWhen: {
            erg: price,
        },
        txSpec: tx,
    };
    return follow(request).then(res => {
        if (res.id !== undefined) {
            let toFollow = {
                id: res.id,
                address: addr,
                info: {
                    address: addr,
                    returnTo: ourAddr,
                    get: `+${amount} ${usdAcronym}`,
                    pay: `-${(price / 1e9).toFixed(2)} ERG`,
                    type: `Purchase ${usdAcronym}`,
                    timestamp: moment().valueOf()
                },
                key: 'operation',
                status: 'follow',
                operation: 'minting stablecoin'
            };
            addReq(toFollow, 'reqs')
            res.price = price
            res.addr = addr
        }
        return res
    })
}

export async function getScMintP2s(amount, oracleBoxId) {
    let ourAddr = getWalletAddress();
    let userTreeHex = new Address(ourAddr).ergoTree
    let userTree = Buffer.from(userTreeHex, 'hex').toString('base64');

    let scTokenId64 = Buffer.from(await scTokenId(), 'hex').toString('base64')
    let oracleBoxId64 = Buffer.from(oracleBoxId, 'hex').toString('base64')

    let scAmount = dollarToCent(amount)

    let script = template
        .replaceAll('$userAddress', userTree)
        .replace('$scAmount', scAmount)
        .replace('$scTokenId', scTokenId64)
        .replaceAll('$oracleBoxId', oracleBoxId64)
        .replaceAll('$timestamp', moment().valueOf())
        .replaceAll('\n', '\\n');
    return p2s(script);
}
