const nearAPI = require("near-api-js");
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const BN = require('bn.js');

const account1kp = nearAPI.utils.KeyPairEd25519.fromRandom();
const account2kp = nearAPI.utils.KeyPairEd25519.fromRandom();
const signer1AccountId = Buffer.from(account1kp.publicKey.data).toString('hex');
const signer2AccountId = Buffer.from(account2kp.publicKey.data).toString('hex');
const contractName = fs.readFileSync('neardev/dev-account').toString();

const keyStore1 = new nearAPI.keyStores.UnencryptedFileSystemKeyStore(
  `${os.homedir()}/.near-credentials/`
);
const keyStore2 = new nearAPI.keyStores.InMemoryKeyStore();
keyStore2.setKey('default', signer1AccountId, account1kp);
keyStore2.setKey('default', signer2AccountId, account2kp);

const keyStore = new nearAPI.keyStores.MergeKeyStore([keyStore1, keyStore2]);

describe('pay for listening', () => {
  it('should mint a token and get paid for listening', async () => {
    console.log(contractName, signer1AccountId, signer2AccountId);

    // Initializing connection to the NEAR node.
    const near = await nearAPI.connect({
      deps: {
        keyStore
      },
      nodeUrl: "https://rpc.testnet.near.org",
      networkId: "default"
    });

    const devAccount = await near.account(contractName);
    await devAccount.sendMoney(signer1AccountId, new BN('100000000000000000000000', 10));
    await devAccount.sendMoney(signer2AccountId, new BN('200000000000000000000000', 10));

    const account1 = await near.account(signer1AccountId);
    await account1.addKey(nearAPI.utils.KeyPairEd25519.fromRandom().publicKey, contractName);

    const account2 = await near.account(signer2AccountId);
    await account2.addKey(nearAPI.utils.KeyPairEd25519.fromRandom().publicKey, contractName);

    let result = await account1.functionCall(contractName, 'mint_to_base64', {
      owner_id: signer1AccountId, supportmixing: true,
      contentbase64: Buffer.from('test').toString('base64')
    }, null, '800000000000000000000');

    const token_id = JSON.parse(Buffer.from(result.status.SuccessValue, 'base64').toString('utf-8'));
    console.log('token id is', token_id);

    await account2.functionCall(contractName, 'buy_listening_credit', {}, null, '100000000000000000000000');

    const listenRequestPassword = crypto.randomBytes(64).toString('base64');
    const listenRequestPasswordHash = crypto.createHash('sha256').update(listenRequestPassword).digest('base64');
    result = await account2.functionCall(contractName, 'request_listening', { token_id: '' + token_id, listenRequestPasswordHash: listenRequestPasswordHash });

    console.log('wait 2 secs before requesting content');
    await new Promise(r => setTimeout(() => r(), 2000));

    result = await account2.viewFunction(contractName, 'get_token_content_base64', { token_id: token_id, caller: signer2AccountId, listenRequestPassword: listenRequestPassword });
    console.log(result);
  });
});
