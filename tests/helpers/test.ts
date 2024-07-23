


import * as anchor from "@coral-xyz/anchor";

export const expectFail = async (promise, message) => {
    let res = null;
    let isError = null
    try {
      res = await promise;
    } catch (err) {
        const errMsg =  err.error?.errorMessage  ||  anchor.AnchorError.parse(err.logs)?.error.errorMessage;
        if(!errMsg.includes(message)) {
            isError = errMsg;
        }
    }

    if(res){
        throw new Error("Call doesn't fail")
    }
    
    if (isError) {
        throw new Error("Reverted with wrong message. Expected: " + message + " but got: " + isError);
    //   throw new Error(message ? message : "Call should've failed");
    }
    return res;
};

export async function expectSystemFail(promise, message) {
    let res = null;
    let isError = null
    try {
      await promise;
    } catch (error) {
      const logs = error.logs || [];
      // Check if any log contains the specific error message
      const log = logs.find((log: string | string[]) => log.includes("Program log: Error: "));
      if(!log.includes(message)) {
        isError = log;
       }
        // console.log(log);
    }

    if(res){
        throw new Error("Call doesn't fail")
    }
    
    if (isError) {
        throw new Error("Reverted with wrong message. Expected: Program log: Error: " + message + " but got: " + isError);
    }

    return res;
  }

export async function createAndSendV0Tx(
    provider: anchor.AnchorProvider,
    txInstructions: anchor.web3.TransactionInstruction[],
    payer: anchor.web3.Signer,
    addressLookupTable: anchor.web3.PublicKey[] | undefined = undefined,
    cp_swap_program: anchor.Program
  ) {
    // Step 1 - Fetch the latest blockhash
    let latestBlockhash = await provider.connection.getLatestBlockhash(
      "confirmed"
    );
  
    // Step 2 - Generate Transaction Message
    let messageV0;
    if (addressLookupTable) {
  
      const result: anchor.web3.AddressLookupTableAccount[] = []
      for (const address of addressLookupTable) {
        const lookupTableAccount = (
          await provider.connection.getAddressLookupTable(address)
        ).value;
        if (!lookupTableAccount) throw new Error("Address Lookup Table not found");
        result.push(lookupTableAccount)
      }
  
      messageV0 = new anchor.web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions,
      }).compileToV0Message(result);
    } else {
      messageV0 = new anchor.web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions,
      }).compileToV0Message();
    }
  
    const transaction = new anchor.web3.VersionedTransaction(messageV0);
  
    // Step 3 - Sign your transaction with the required `Signers`
    transaction.sign([payer]);
  
    // Step 4 - Send our v0 transaction to the cluster
    const txid = await provider.connection.sendTransaction(transaction, {
      maxRetries: 5,
    }).catch(err => {
      console.error(err)
      if (err.logs) {
        err.logs.forEach(element => {
          console.error(element)
        });
        parseEvents(cp_swap_program, err.logs);
      }
      throw new Error(err)
    });
  
    // Step 5 - Confirm Transaction
    const confirmation = await provider.connection.confirmTransaction({
      signature: txid,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');
  
    if (confirmation.value.err) {
      throw new Error(
        `   ❌ - Transaction not confirmed.\nReason: ${confirmation.value.err}`
      );
    }
  
    return txid;
}


export function parseEvents(program: anchor.Program<any>, logMessages:  string[]){
  logMessages.forEach(a=>{
    if(a.includes('Program data:', 0)){
      const tmp = a.split(': ');
      // console.log(tmp[1]);
      const obj = program.coder.events.decode(tmp[1]);
      console.log("EVENT: " + obj.name);
      for (const key in obj.data) {
        console.log(key + "  " + obj.data[key].toString());
      }
      console.log("-------------------------------------------------");
    }
    
  })

}