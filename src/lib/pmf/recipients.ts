export interface PmfRecipients {
  sms: string;
  email: string;
  operatorUserId: string;
}

export function getPmfRecipients(): PmfRecipients {
  const sms = process.env.PMF_NOTIFICATION_SMS;
  const email = process.env.PMF_NOTIFICATION_EMAIL;
  const operatorUserId = process.env.PMF_OPERATOR_USER_ID;
  if (!sms || !email || !operatorUserId) {
    throw new Error('PMF recipients env vars missing');
  }
  return { sms, email, operatorUserId };
}
