import { initEccLib, payments, Psbt, script } from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
import axios, { AxiosResponse } from "axios";
import { Etching, none, Range, Rune, Runestone, some, Terms } from "runelib";

initEccLib(ecc);

interface IUTXO {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
  value: number;
}

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
  SigWitaddress: "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt",
  TaprootAddress:
    "tb1pfnjw2x98jm7yhjxykpfmw8l9syj6wau86v6e0hjuzxk9u6euvuxs4xka06",
};

const keypair = ECpair.fromWIF(walletData.privateKeyWIF, network);

const mempool = new axios.Axios({
  baseURL: `https://mempool.space/testnet4/api`,
});

export async function waitUntilUTXO(address: string) {
  return new Promise<IUTXO[]>((resolve, reject) => {
    let intervalId: any;
    const checkForUtxo = async () => {
      try {
        const response: AxiosResponse<string> = await mempool.get(
          `/address/${address}/utxo`
        );
        const data: IUTXO[] = response.data
          ? JSON.parse(response.data)
          : undefined;
        console.log(data);
        if (data.length > 0) {
          resolve(data);
          clearInterval(intervalId);
        }
      } catch (error) {
        reject(error);
        clearInterval(intervalId);
      }
    };
    intervalId = setInterval(checkForUtxo, 5000);
  });
}

function createRuneEtching() {
  const name = "LUND•LELO•RUNE";

  const rune = Rune.fromName(name);

  const terms = new Terms(
    1000,
    10000,
    new Range(none(), none()),
    new Range(none(), none())
  );

  const etching = new Etching(
    some(1),
    some(1000000),
    some(rune),
    none(),
    some("#"),
    some(terms),
    true
  );

  const stone = new Runestone([], some(etching), none(), none());

  const buffer = stone.encipher();
  return buffer;
}

async function etchRune() {
  try {
    // Create the rune etching data
    const runeBuffer = createRuneEtching();

    // Get UTXOs for funding from Segwit address

    const utxos = await waitUntilUTXO(walletData.SigWitaddress as string);
    console.log(utxos);
    if (utxos.length === 0) {
      throw new Error("No UTXOs found for the address");
    }
    console.log(`Using UTXO ${utxos[0].txid}:${utxos[0].vout}`);

    if (utxos.length === 0) {
      console.error("No UTXOs found for address:", walletData.SigWitaddress);
      return;
    }

    // Find a suitable UTXO with enough value
    const suitableUtxo = utxos.find((utxo: any) => utxo.value >= 7000);
    if (!suitableUtxo) {
      console.error("No suitable UTXO found with sufficient value");
      return;
    }

    const publicKey =
      keypair.publicKey instanceof Uint8Array
        ? Buffer.from(keypair.publicKey)
        : keypair.publicKey;

    // Create Segwit v0 payment for the input
    const p2wpkh = payments.p2wpkh({
      pubkey: publicKey,
      network,
    });

    // Create PSBT
    const psbt = new Psbt({ network });

    psbt.addInput({
      hash: suitableUtxo.txid,
      index: suitableUtxo.vout,
      witnessUtxo: {
        script: p2wpkh.output!,
        value: suitableUtxo.value,
      },
    });

    // Add OP_RETURN output with rune data
    const runeScript = script.compile([
      script.OPS.OP_RETURN,
      script.OPS.OP_13,
      runeBuffer,
    ]);

    psbt.addOutput({
      script: runeScript,
      value: 0,
    });

    const estimatedFee = 1000;
    const changeAmount = suitableUtxo.value - estimatedFee;

    if (changeAmount > 546) {
      // Send change to Taproot address where runes will be allocated
      psbt.addOutput({
        address: walletData.SigWitaddress,
        value: changeAmount,
      });
    }

    // Sign the Segwit input
    psbt.signInput(0, {
      publicKey: Buffer.from(keypair.publicKey),
      sign: (hash) => Buffer.from(keypair.sign(hash)),
    });

    // Validate the signatures
    const validator = (
      pubkey: Buffer,
      msghash: Buffer,
      signature: Buffer
    ): boolean => {
      return ecc.verify(msghash, pubkey, signature);
    };

    if (psbt.validateSignaturesOfInput(0, validator)) {
      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      const txHex = tx.toHex();
      console.log("Signed transaction hex:", txHex);
      console.log("Transaction ID:", tx.getId());

      // Broadcast transaction to mempool.space
      try {
        const response = await axios.post(
          "https://mempool.space/testnet4/api/tx",
          txHex,
          {
            headers: { "Content-Type": "text/plain" },
            timeout: 30000,
          }
        );
        console.log("Transaction broadcasted successfully!");
        console.log("TXID:", tx.getId());
        console.log("Rune etched successfully!");
      } catch (broadcastError: any) {
        console.error("Error broadcasting transaction:");
        if (broadcastError.response) {
          console.error("Status:", broadcastError.response.status);
          console.error("Error message:", broadcastError.response.data);
        } else {
          console.error(broadcastError.message);
        }

        // Try alternative broadcast method
        console.log("Trying alternative broadcast...");
        try {
          const response = await axios.post(
            "https://blockstream.info/testnet/api/tx",
            txHex,
            {
              headers: { "Content-Type": "text/plain" },
              timeout: 30000,
            }
          );
          console.log("Transaction broadcasted via Blockstream!");
          console.log("TXID:", tx.getId());
        } catch (error2) {
          console.error("Error with Blockstream API:", error2);
          console.log("Raw transaction hex (you can broadcast manually):");
          console.log(txHex);
        }
      }
    } else {
      console.error("Signature validation failed");
    }
  } catch (error) {
    console.error("Error etching rune:", error);
  }
}

// Execute the rune etching
etchRune();
