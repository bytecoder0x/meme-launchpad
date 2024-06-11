


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