import { RuneId, Runestone, SpacedRune, Symbol } from "./lib";
import { U32, U64, U128 } from "big-varuint-js";
import {
  initEccLib,
  opcodes,
  script,
  payments,
  Psbt
} from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
import axios from "axios";

initEccLib(ecc);

const FEE_RATE = 20;

const testnet4 = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "tb",
  bip32: { public: 0x0420bd3a, private: 0x0420b900 },
  pubKeyHash: 0x7b,
  scriptHash: 0x82,
  wif: 0xef,
};

const network = testnet4;
const ECpair = ECPairFactory(ecc);

// Wallet configuration
const walletData = {
  privateKeyWIF: "cNRSftURLH3gVdiwyyH3qG8gEk3oZfxuMkdPyqkYEerhxMudsuiM",
  addresses: {
    legacy: "mhbn5ENcGHq7V2QVK9kaTrN3bARYJb3JRv",
    segwit: "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt",
    wrapped: "2NDVyHqTE7QhytJufPz3nAVgcZrYNm5aCDS",
  },
  primaryAddress: "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt",
};

const keypair = ECpair.fromWIF(walletData.privateKeyWIF, network);
const pubKeyXonly = Buffer.from(keypair.publicKey.subarray(1, 33));

const RUNE_RECEIVE_VALUE = 600;

function createRune() {
  const spacedRune = SpacedRune.fromString("OMKAR.K.RUNE");

  const runestone = new Runestone({
    edicts: [],
    pointer: new U32(0n),
    etching: {
      rune: spacedRune.rune,
      spacers: spacedRune.spacers,
      premine: new U128(1000_000n),
      symbol: Symbol.fromString("O"),
      terms: {
        amount: new U128(1000n),
        cap: new U128(100n),
      },
    },
    mint: new RuneId(new U64(98661n), new U32(18n)),
  });

  const buffer = runestone.enchiper();
  console.log(buffer.toString('hex'), "buffer")
  
  return { buffer, commitBuffer: runestone.etching?.rune?.commitBuffer() };
}


function createMintPayment(commitBuffer: Buffer) {
  const ordinalStacks = [
    pubKeyXonly,
    opcodes.OP_CHECKSIG,
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    1,
    Buffer.from("text/plain;charset=utf-8", "utf8"),
    1,
    2,
    opcodes.OP_0,
    1,
    13,
    commitBuffer,
    opcodes.OP_0,
    Buffer.from("Chainwave", "utf8"),
    opcodes.OP_ENDIF,
  ];
  const ordinalScript = script.compile(ordinalStacks);

  console.log(ordinalScript.toString('hex'), "ordinalScript")

  const scriptTree = {
    output: ordinalScript,
  };

  const redeem = {
    output: ordinalScript,
    redeemVersion: 192,
  };

  const payment = payments.p2tr({
    internalPubkey: pubKeyXonly,
    network,
    scriptTree,
    redeem,
  });

  return {
    payment,
    redeem,
  };
}

function createPsbt(
  payment: payments.Payment,
  redeem: {
    output: Buffer;
    redeemVersion: number;
  },
  hash: Buffer,
  index: number,
  satValue: number,
  receiverAddress: string,
  runeBuffer: Buffer
) {
  const psbt = new Psbt({ network });
  psbt.addInput({
    hash,
    index,
    tapInternalKey: pubKeyXonly,
    witnessUtxo: {
      script: payment.output!,
      value: satValue,
    },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: payment.witness![payment.witness!.length - 1],
      },
    ],
  });

  psbt.addOutput({
    address: receiverAddress,
    value: RUNE_RECEIVE_VALUE,
  });

  const runeScript = script.compile([
    opcodes.OP_RETURN,
    opcodes.OP_13,
    runeBuffer,
  ]);
  psbt.addOutput({
    script: runeScript,
    value: 0,
  });

  return psbt;
}

function calculateFee(
  payment: payments.Payment,
  redeem: {
    output: Buffer;
    redeemVersion: number;
  },
  receiverAddress: string,
  runeBuffer: Buffer
) {
  const estimatedVSize = 250;
  return estimatedVSize * FEE_RATE;
}

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

async function main() {
  // STEP 1, create payment address and fund the balance
  const rune = createRune();
  const payment = createMintPayment(rune.commitBuffer!);
  const receiverAddress = "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt";

  const fee = calculateFee(
    payment.payment,
    payment.redeem,
    receiverAddress,
    rune.buffer
  );
  const fundValue = fee + RUNE_RECEIVE_VALUE;

  console.log(
    `- please fund this address ${payment.payment.address} ${fundValue} sat`
  );
  console.log(
    `- wait until >=6 block confirmation and then continue to step 2`
  );

  // Wait for user to confirm they've funded the address
  console.log("Press any key to continue after funding...");
  // You might want to implement a proper wait mechanism here

  // STEP 2, get UTXOs for the funded address
  const utxos = await getUTXOsForAddress(payment.payment.address!);

  if (utxos.length === 0) {
    console.error("No UTXOs found for address:", payment.payment.address);
    return;
  }

  // Find a UTXO with sufficient value
  const suitableUtxo = utxos.find((utxo: any) => utxo.value >= fundValue);

  if (!suitableUtxo) {
    console.error("No suitable UTXO found with sufficient value");
    return;
  }

  const txHash = suitableUtxo.txid;
  const txIndex = suitableUtxo.vout;
  const utxoValue = suitableUtxo.value;

  // Convert hash to Buffer and reverse it (bitcoinjs-lib uses little-endian)
  const hashBuffer = Buffer.from(txHash, "hex").reverse();

  const psbt = createPsbt(
    payment.payment,
    payment.redeem,
    hashBuffer,
    txIndex,
    utxoValue,
    receiverAddress,
    rune.buffer
  );

  try {
    const signer = {
      publicKey: Buffer.from(keypair.publicKey),
      sign: (hash: Buffer) => {
        return Buffer.from(keypair.signSchnorr(hash));
      },
      signSchnorr: (hash: Buffer) => {
        return Buffer.from(keypair.signSchnorr(hash));
      },
    };

    psbt.signInput(0, signer);

    const validator = (
      pubkey: Buffer,
      msghash: Buffer,
      signature: Buffer
    ): boolean => {
      return ecc.verifySchnorr(msghash, pubkey, signature);
    };

    if (psbt.validateSignaturesOfInput(0, validator)) {
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();
      console.log({ txHex });

      // Broadcast the transaction
      try {
        const response = await axios.post(
          "https://mempool.space/testnet4/tx/push",
          { tx: txHex }
        );
        console.log("Transaction broadcasted:", response.data);
      } catch (broadcastError) {
        console.error("Error broadcasting transaction:", broadcastError);
        // Try alternative API
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
    } else {
      console.log("Signature validation failed, trying to extract anyway");
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();
      console.log({ txHex });
    }
  } catch (signError) {
    console.error("Signing error:", signError);
  }
}

main();
