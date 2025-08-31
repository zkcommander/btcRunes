import { initEccLib, payments, Psbt, script } from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
import axios from "axios";
import { RuneId, Runestone } from "./lib";
import { U128, U32, U64 } from "big-varuint-js";

initEccLib(ecc);

const testnet4 = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "tb",
  bip32: { public: 0x0420bd3a, private: 0x0420b900 },
  pubKeyHash: 0x7b,
  scriptHash: 0x82,
  wif: 0xef,
};

const ECpair = ECPairFactory(ecc);
const network = testnet4;

const walletData = {
  privateKeyWIF: "cNRSftURLH3gVdiwyyH3qG8gEk3oZfxuMkdPyqkYEerhxMudsuiM",
  address: "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt",
};

// 98808:199

const RUNE_ID = new RuneId(new U64(98808n), new U32(199n));
const MINT_AMOUNT = 1000;

const keypair = ECpair.fromWIF(walletData.privateKeyWIF, network);

async function getUTXOsForAddress(address: string) {
  try {
    const response = await axios.get(
      `https://mempool.space/testnet4/api/address/${address}/utxo`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching UTXOs:", error);
    return [];
  }
}

async function mintRune() {
  try {
    const utxos = await getUTXOsForAddress(walletData.address);

    if (utxos.length === 0) {
      console.error("No UTXOs found for address:", walletData.address);
      return;
    }

    const suitableUtxo = utxos.find((utxo: any) => utxo.value >= 5000);
    if (!suitableUtxo) {
      console.error("No suitable UTXO found with sufficient value");
      return;
    }

    const publicKey =
      keypair.publicKey instanceof Uint8Array
        ? Buffer.from(keypair.publicKey)
        : keypair.publicKey;

    const payment = payments.p2wpkh({
      pubkey: publicKey,
      network,
    });

    const edict = {
      id: RUNE_ID,
      amount: new U128(BigInt(MINT_AMOUNT)),
      output: new U32(0n),
    };

    const mintRunestone = new Runestone({
      edicts: [edict],
      mint: RUNE_ID,
      pointer: new U32(0n),
    });

    const runestoneBuffer = mintRunestone.enchiper();

    const psbt = new Psbt({ network });

    psbt.addInput({
      hash: suitableUtxo.txid,
      index: suitableUtxo.vout,
      witnessUtxo: {
        script: payment.output!,
        value: suitableUtxo.value,
      },
    });

    psbt.addOutput({
      address: walletData.address,
      value: 546,
    });

    const runeChunks = [
      script.OPS.OP_RETURN,
      script.OPS.OP_13,
      runestoneBuffer,
    ];
    const opReturnScript = script.compile(runeChunks);

    psbt.addOutput({
      script: opReturnScript,
      value: 0,
    });

    const estimatedFee = 250;
    if (suitableUtxo.value > 546 + estimatedFee) {
      psbt.addOutput({
        address: walletData.address,
        value: suitableUtxo.value - 546 - estimatedFee,
      });
    }

    psbt.signInput(0, {
      publicKey: Buffer.from(keypair.publicKey),
      sign: (hash) => Buffer.from(keypair.sign(hash)),
    });
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    console.log("Signed transaction:", txHex);

    try {
      const response = await axios.post(
        "https://mempool.space/testnet4/api/tx",
        txHex,
        { headers: { "Content-Type": "text/plain" } }
      );
      console.log("Transaction broadcasted:", response.data);
      console.log(
        `Minted ${MINT_AMOUNT} units of rune ${RUNE_ID.block}:${RUNE_ID.tx}`
      );
    } catch (broadcastError) {
      console.error("Error broadcasting transaction:", broadcastError);
      try {
        const response = await axios.post(
          "https://testnet-api.smartbit.com.au/v1/blockchain/pushtx",
          { hex: txHex }
        );
        console.log(
          "Transaction broadcasted via alternative API:",
          response.data
        );
      } catch (error2) {
        console.error("Error with alternative API too:", error2);
      }
    }
  } catch (error) {
    console.error("Error minting rune:", error);
  }
}

mintRune();