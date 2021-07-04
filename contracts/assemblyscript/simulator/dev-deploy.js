const nearAPI = require("near-api-js");
const os = require('os');
const crypto = require('crypto');

const signer1AccountId = "psalomo.testnet";
const signer2AccountId = "acl.testnet";
const contractName = "dev-1625333053636-62211230962844";

const keyStore = new nearAPI.keyStores.UnencryptedFileSystemKeyStore(
    `${os.homedir()}/.near-credentials/`
);

async function main() {
    // Initializing connection to the NEAR node.
    const near = await nearAPI.connect({
      deps: {
        keyStore,
      },
      nodeUrl: "https://rpc.testnet.near.org",
      networkId: "default"
    });
  
    const account1 = await near.account(signer1AccountId);
    const account2 = await near.account(signer2AccountId);
    const listenprice = '800000000000000000000';
    /*// peter is minting
   let result = await account1.functionCall(contractName, 'mint_to_base64', {
            owner_id: signer1AccountId, supportmixing: true,
            contentbase64: Buffer.from('test').toString('base64')
        },null,'800000000000000000000');

    const token_id = JSON.parse(Buffer.from(result.status.SuccessValue, 'base64').toString('utf-8'));
    console.log('token id is', token_id);

    await account1.functionCall(contractName, 'set_listening_price', {token_id: ''+token_id, price: listenprice});
*/
    const token_id = '60';
    const listenRequestPassword = crypto.randomBytes(64).toString('base64');
    const listenRequestPasswordHash = crypto.createHash('sha256').update(listenRequestPassword).digest('base64');
    result = await account2.functionCall(contractName, 'request_listening', {token_id: ''+token_id, listenRequestPasswordHash: listenRequestPasswordHash}, null, listenprice);
    
    console.log('wait 5 secs before requesting content');
    await new Promise(r => setTimeout(() => r(), 5000));

    result = await account2.viewFunction(contractName, 'get_token_content_base64', {token_id: token_id, caller: signer2AccountId, listenRequestPassword: listenRequestPassword});
    console.log(result);
  }
  
  main();