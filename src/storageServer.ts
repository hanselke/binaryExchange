//const cors = require('cors');
import express from 'express';
import cors from 'cors';
import fs from 'fs';

import {
  isReady,
  PrivateKey,
  Field,
  MerkleTree,
  Poseidon,
  Signature,
  PublicKey,
  fetchAccount,
  Mina,
  Bool
} from 'snarkyjs';

await isReady;
import { OrderBook, Order, MyMerkleWitness,LeafUpdate,LocalOrder } from './OrderBook';
console.log(
  'CAUTION: This project is in development and not to be relied upon to guarantee storage in production environments.'
);

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ==============================================================================

const maxHeight = 256;

const useLocalBlockchain = false;

const Local = Mina.LocalBlockchain();
if (useLocalBlockchain) {
  Mina.setActiveInstance(Local);
} else {
  const Berkeley = Mina.BerkeleyQANet(
    'https://proxy.berkeley.minaexplorer.com/graphql'
  );
  Mina.setActiveInstance(Berkeley);
}

const saveFile = 'database.json';

// ==============================================================================

type data_obj_map = {
  [root: string]: { rootNumber: number; orders: LocalOrder[] };
};

let database: {
  [zkAppAddress: string]: {
    nextNumber: number;
    height: number;
    root2data: data_obj_map;
  };
} = {};

let serverPrivateKey: PrivateKey;
if (fs.existsSync(saveFile)) {
  var fileData = fs.readFileSync(saveFile, 'utf8');
  const data = JSON.parse(fileData);
  database = data.database;
  serverPrivateKey = PrivateKey.fromBase58(data.serverPrivateKey58);
  console.log('found database');
} else {
  serverPrivateKey = PrivateKey.random();

  fs.writeFileSync(
    saveFile,
    JSON.stringify({
      database,
      serverPrivateKey58: serverPrivateKey.toBase58(),
    }),
    'utf8'
  );
}

const serverPublicKey = serverPrivateKey.toPublicKey();

console.log('Server using public key', serverPublicKey.toBase58());

// ==============================================================================

(async () => {
  for (;;) {
    console.log('running cleanup');

    for (let zkAppAddress in database) {
      let response = await fetchAccount({
        publicKey: PublicKey.fromBase58(zkAppAddress),
      });
      if (response.account != null) {
        let accountRootNumberF = Field(response.account.appState![1]);
        let accountRootNumber = accountRootNumberF.toBigInt();
        var root2data = database[zkAppAddress].root2data;
        database[zkAppAddress].root2data = {};
        console.log('cleaning up', zkAppAddress);
        for (let root in root2data) {
          if (root2data[root].rootNumber >= accountRootNumber) {
            database[zkAppAddress].root2data[root] = root2data[root];
          }
        }
      }
    }

    fs.writeFileSync(
      saveFile,
      JSON.stringify({
        database,
        serverPrivateKey58: serverPrivateKey.toBase58(),
      }),
      'utf8'
    );

    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
})();

// ==============================================================================

app.post('/data', (req, res) => {
  const height: number = req.body.height;

  const orders: LocalOrder[] = req.body.orders;
  const zkAppAddress58: string = req.body.zkAppAddress;
  console.log('post data called', height, orders);

  const idx2fields = new Map<bigint, LocalOrder>();
  orders.forEach((localOrder) => {
    idx2fields.set(BigInt(localOrder.orderIndex.toString()),localOrder)
  })
  const tree = new MerkleTree(height);

  for (let [idx, localOrder] of idx2fields) {
    console.log("got idx",idx,localOrder)
    // idex.toBigInt doesnt seem to bloody work!!
    // cant call localOrder.hash() wtf how come?
    console.log("before setLeaf")
    console.log("typeof idx",typeof idx),
    

    console.log("hash orderindex",Poseidon.hash([Field(localOrder.orderIndex)]))
    console.log("hash publickey",Poseidon.hash([Field(localOrder.order.maker)])) //this prob deps on js toString??
    console.log("hash order",Poseidon.hash([]))
    console.log("hash order",Poseidon.hash([]))
    console.log("hash order",Poseidon.hash([]))
    console.log("hash order",Poseidon.hash([]))
    console.log("hash order",Poseidon.hash([]))

    tree.setLeaf(idx, Poseidon.hash([
      Field(localOrder.orderIndex),
      Poseidon.hash([
        ...PublicKey.from(localOrder.order.maker).toFields(),
        Field(localOrder.order.orderAmount),
        Field(localOrder.order.orderPrice),
        Bool(localOrder.order.isSell).toField(),
      ]),
      Field(localOrder.nextIndex),
      Field(localOrder.prevIndex)
    ]));
    console.log("after setLeaf")
  }
  console.log("idx2fields loop done")

  if (height > maxHeight) {
    res.status(400).send({
      error:
        'height is too large. A max height of ' +
        maxHeight +
        ' is supported for this implementation',
    });
    return;
  }

  if (orders.length > 2 ** (height - 1)) {
    res.status(400).send({
      error: 'too many orders for height',
    });
    return;
  }

  if (!(zkAppAddress58 in database)) {
    database[zkAppAddress58] = {
      nextNumber: 1,
      height,
      root2data: {},
    };
  }

  if (database[zkAppAddress58].height != height) {
    res.status(400).send({ error: 'wrong height' });
    return;
  }

  const newRoot = tree.getRoot();
  const newRootNumber = Field(database[zkAppAddress58].nextNumber);

  database[zkAppAddress58].nextNumber += 1;
  database[zkAppAddress58].root2data[newRoot.toString()] = {
    rootNumber: Number(newRootNumber.toBigInt()),
    orders,
  };
  console.log('post data gona store data');
  fs.writeFileSync(
    saveFile,
    JSON.stringify({
      database,
      serverPrivateKey58: serverPrivateKey.toBase58(),
    }),
    'utf8'
  );

  let newRootSignature = Signature.create(serverPrivateKey, [
    newRoot,
    newRootNumber,
  ]);

  console.log('storing', zkAppAddress58, newRoot.toString());

  res.json({
    result: [
      newRootNumber.toString(),
      newRootSignature.toFields().map((f) => f.toString()),
    ],
  });
  return;
});

// ==============================================================================

app.get('/data', (req, res) => {
  const zkAppAddress58 = req.query.zkAppAddress;
  const root = req.query.root;
  console.log('GET /data', root, zkAppAddress58);
  if (typeof zkAppAddress58 == 'string' && typeof root == 'string') {
    console.log('getting', zkAppAddress58, root);

    if (database[zkAppAddress58]) {
      if (database[zkAppAddress58].root2data[root]) {
        res.json({
          orders: database[zkAppAddress58].root2data[root].orders,
        });
        return;
      } else {
        // root is wrong
        console.log('database[zkAppAddress58]', database[zkAppAddress58]);
        res.send(400).send({ error: 'you are using the wrong root' });
        return;
      }
    } else {
      // we cant return emptyFilled here because we dont have tree height
      res.status(400).send({ error: 'no data for address' });
      return;
    }
  } else {
    res.status(400).send({ error: 'bad query params' });
    return;
  }
});

// ==============================================================================

app.get('/publicKey', (req, res) => {
  res.json({
    serverPublicKey58: serverPublicKey.toBase58(),
  });
});

// ==============================================================================

app.listen(port, () =>
  console.log(`Storage Server listening on port ${port}!`)
);

// ==============================================================================
