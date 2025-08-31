import {
  script,
  Psbt,
  initEccLib,
  Signer as BTCSigner,
  crypto,
  payments,
} from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";
import { ECPairFactory } from "ecpair";
import ecc from "@bitcoinerlab/secp256k1";
import axios, { AxiosResponse } from "axios";
import {
  Rune,
  Runestone,
  EtchInscription,
  none,
  some,
  Terms,
  Range,
  Etching,
} from "runelib";

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

initEccLib(ecc as any);
const ECPair: any = ECPairFactory(ecc);
const testnet4 = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "tb",
  bip32: { public: 0x0420bd3a, private: 0x0420b900 },
  pubKeyHash: 0x7b,
  scriptHash: 0x82,
  wif: 0xef,
};

const network = testnet4;

const walletData = {
  privateKeyWIF: "cNRSftURLH3gVdiwyyH3qG8gEk3oZfxuMkdPyqkYEerhxMudsuiM",
  SigWitaddress: "tb1qjsem458tjafd3g3364tvqvs7tr6wndgy4al3yt",
  TaprootAddress:
    "tb1pfnjw2x98jm7yhjxykpfmw8l9syj6wau86v6e0hjuzxk9u6euvuxs4xka06",
};

const keyPair = ECPair.fromWIF(walletData.privateKeyWIF, network);
const pubKeyXonly = Buffer.from(keyPair.publicKey.subarray(1, 33));

// Helper functions

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

export async function getTx(id: string): Promise<string> {
  const response: AxiosResponse<string> = await mempool.get(`/tx/${id}/hex`);
  return response.data;
}

export async function signAndSend(
  keyPair: BTCSigner,
  psbt: Psbt,
  address: string,
  leafHash: Buffer
) {
  if (process.env.NODE) {
    const signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => {
        if (typeof keyPair.signSchnorr === "function") {
          return Buffer.from(keyPair.signSchnorr(hash));
        } else {
          throw new Error("signSchnorr is not defined on keyPair");
        }
      },
      signSchnorr: (hash: Buffer) => {
        if (typeof keyPair.signSchnorr === "function") {
          return Buffer.from(keyPair.signSchnorr(hash));
        } else {
          throw new Error("signSchnorr is not defined on keyPair");
        }
      },
    };
    psbt.signInput(0, signer);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    console.log(`Broadcasting Transaction Hex: ${tx.toHex()}`);
    console.log(tx.virtualSize());
    const txid = await broadcast(tx.toHex());
    console.log(`Success! Txid is ${txid}`);
  }
  // else {
  //   try {
  //     let res = await window.unisat.signPsbt(psbt.toHex(), {
  //       toSignInputs: [
  //         {
  //           index: 0,
  //           address: address,
  //         },
  //       ],
  //     });

  //     console.log("signed psbt", res);

  //     res = await window.unisat.pushPsbt(res);

  //     console.log("txid", res);
  //   } catch (e) {
  //     console.log(e);
  //   }
  // }
}

export async function broadcast(txHex: string) {
  const response: AxiosResponse<string> = await mempool.post("/tx", txHex);
  return response.data;
}

async function etching() {
  const name = "SECOND•RUNE•BITCOIN";

  const ins = new EtchInscription();

  const fee = 2000;

  const HTMLContent = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>RUNE ON BITCOIN</title>
    </head>
  </html>`;

  ins.setContent("text/html;charset=utf-8", Buffer.from(HTMLContent, "utf8"));
  ins.setRune(name);

  const etching_script_asm = `${pubKeyXonly.toString("hex")} OP_CHECKSIG`;
  const etching_script = Buffer.concat([
    script.fromASM(etching_script_asm),
    ins.encipher(),
  ]);

  const scriptTree: Taptree = {
    output: etching_script,
  };

  const script_p2tr = payments.p2tr({
    internalPubkey: pubKeyXonly,
    scriptTree,
    network,
  });

  const etching_redeem = {
    output: etching_script,
    redeemVersion: 192,
  };

  const etching_p2tr = payments.p2tr({
    internalPubkey: pubKeyXonly,
    scriptTree,
    redeem: etching_redeem,
    network,
  });

  const leafHash = crypto.taggedHash(
    "TapLeaf",
    Buffer.concat([Buffer.from([etching_redeem.redeemVersion]), etching_script])
  );

  const address = script_p2tr.address ?? "";
  console.log("send coin to address", address);

  const utxos = await waitUntilUTXO(address as string);
  console.log(utxos);
  if (utxos.length === 0) {
    throw new Error("No UTXOs found for the address");
  }
  console.log(`Using UTXO ${utxos[0].txid}:${utxos[0].vout}`);

  const psbt = new Psbt({ network });

  psbt.addInput({
    hash: utxos[0].txid,
    index: utxos[0].vout,
    witnessUtxo: { value: utxos[0].value, script: script_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: etching_redeem.redeemVersion,
        script: etching_redeem.output,
        controlBlock: etching_p2tr.witness![etching_p2tr.witness!.length - 1],
      },
    ],
  });

  const rune = Rune.fromName(name);

  const terms = new Terms(
    100,
    100000,
    new Range(none(), none()),
    new Range(none(), none())
  );

  const etching = new Etching(
    some(1),
    some(100000),
    some(rune),
    none(),
    some("$"),
    some(terms),
    true
  );

  const stone = new Runestone([], some(etching), none(), none());

  psbt.addOutput({
    script: stone.encipher(),
    value: 0,
  });

  const change = utxos[0].value - 546 - fee;

  if (change < 0) {
    throw new Error("Insufficient funds to cover fee and dust output");
  }

  psbt.addOutput({
    address: walletData.TaprootAddress,
    value: 546,
  });

  if (change > 0) {
    psbt.addOutput({
      address: walletData.TaprootAddress,
      value: change,
    });
  }

  await signAndSend(keyPair, psbt, address as string, leafHash);
}

etching();