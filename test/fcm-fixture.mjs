import { generateKeyPairSync } from 'node:crypto';

export const tokenUri = 'https://oauth.example.test/token';
export const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const serviceAccount = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test-key',
  private_key: signingKey.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'relay@example.test',
  token_uri: tokenUri,
};
