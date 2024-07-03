


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