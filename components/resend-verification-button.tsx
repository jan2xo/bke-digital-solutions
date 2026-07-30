"use client";
import { useState } from "react";

export function ResendVerificationButton({deliveryFailed=false}:{deliveryFailed?:boolean}){
  const[busy,setBusy]=useState(false);const[message,setMessage]=useState(deliveryFailed?"Your account was created, but the first email could not be delivered. Please request another after email delivery is configured.":"");
  async function resend(){
    setBusy(true);setMessage("");
    const response=await fetch("/api/auth/verification/resend",{method:"POST"});
    const body=await response.json();setBusy(false);
    if(response.ok){setMessage(body.alreadyVerified?"Your email is already verified.":"A new verification email was sent. Check your inbox and spam folder.");return}
    setMessage(body.error==="EMAIL_NOT_CONFIGURED"?"Email delivery is not configured yet. Ask the site administrator to connect Resend.":body.error==="RATE_LIMITED"?"Too many requests. Please wait before requesting another email.":"We could not send the email. Please try again later.");
  }
  return <div className="mt-8"><button className="button" type="button" onClick={resend} disabled={busy}>{busy?"Sending…":"Resend verification email"}</button>{message&&<p className="mt-4 text-sm font-semibold" role="status">{message}</p>}</div>
}
