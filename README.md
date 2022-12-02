## Mina zkApp: Binaryexchange

This template uses TypeScript.

## design arch

1) Offchain orderbook store server
    a) Has nodejs? based offchain code
    b) has mina smartcontracts to verify merkle roots and updates
    c) relays data to browsers

2) Onchain Orderbook functionality that deps on 1)
    a) this should be somehow integrated into 1's offchain receive need update orders process.
        1) use a watcher? but thats lame and slow. must be a better way
## TODOs

Critical Q) Assuming we're only dealing with readonlys of offchain orderbook.

The purpose is to build into the fillOrder function, some sort of verification that

I want my orderbook data to run faster then minaprotocol runs.

So that means that while offchain storage would keep sending tx's to update, it'll be a while before clients can confirm if my offchain storage updates are valid?

They'll have to trust me that i didnt muck around on the offchain server side?


1) figure out how the offchain data can interact with the smart contract restrictions


2) fillOrder in OrderBook smart contract

LATER) Offchain server must be made reliable
https://github.com/es92/zkApp-offchain-storage/blob/main/src/storageServer.ts

currently uses a flat file on the server. could setup a kafka based HA storage?



## How to build

```sh
npm run build
```

## How to run tests

```sh
npm run test
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```


1) we can have functions, that have a unique signature, that gets bundled with the output of the function
    a) we do not need to know the inputs of the function, to trust that the function ran.
        1) users can have private data input into the function without telling us that private data

write a function that is

verifyDBSBalance(dbs auth) {

    return fetch("www.dbs.com.sg", withAuth, getBalance);

}



## proof of assets product

enable people to proof that many internal projects budgets are backed by real cash in their web2 bank accounts.

assumptions: web2 bank accounts have suitable accounting heads marked in their tx, so we can split them into different projects.



user's client browser/nodejs

cronjob every day i run

verifyDBSBalance(mysecret);


chrome extenstion's roles
    1) ensure that data comes from defined url
    2) ensure that outputData we need, comes from the right place
    3) now we need to try and make it run in a browser smart contract, this is where it gets tricky
        a) prob want to relay it to our own webapp, that now executes the smart contract in the normal mina style.


every x time, will popup and ask if user is ready to execute verify. then if they click yes

1) navtigateto bank website 
2) user inputs userid/password (user manually input, we dont store/touch the secrets)
3) we navigate to the right page
4) we extract the value we need, and pass it thru the chrome extension, to our zkMethod that will be provided.
    a) ignore security considerations, of if someone hacked your chrome extenstions
        1) we'll try to find someway to make this part of the minaprotocol circuit 


if we can depend on curl and run nodejs based functions


smart contracts are run entirely serverside     -they will be much faster then browser functions to run (by right we dont really care about speed for the cronjob based tasks that need to run)




simplest way to use tech without their infra


proven circuit (proven function) on a function that simply uses secrets, to run a hardcoded function on verifiedSource(curl an apiendpoint with secret) data to relay output(dont process output and simply relay) to specified apiendpoint

on endpoint we receive
    -function sig that includes gurantees of our apiendpoint
    - gurantees of source of their private truth.



