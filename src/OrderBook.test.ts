import { OrderBook, Order, MyMerkleWitness,LeafUpdate,LocalOrder } from './OrderBook';
import { MyToken } from "./Token";

import {
  isReady,
  shutdown,
  PrivateKey,
  PublicKey,
  Mina,
  AccountUpdate,
  Field,
  Struct,
  Bool,
  MerkleTree,
  Circuit,
  Poseidon,
  Signature,
  UInt64
} from 'snarkyjs';


describe('OrderBook.js', () => {
  let zkApp: OrderBook,
    zkAppPrivateKey: PrivateKey,
    zkAppAddress: PublicKey,
    deployer: PrivateKey,
    alicePrivateKey: PrivateKey,
    bobPrivateKey: PrivateKey,
    janePrivateKey: PrivateKey,
    tomPrivateKey: PrivateKey,
    storageServerPublicKey: PublicKey

  let token1ZkappKey: PrivateKey;
  let token1ZkappAddress: PublicKey;
  let token1Zkapp: MyToken;
  let token1Id: Field;
    
  let token2ZkappKey: PrivateKey;
  let token2ZkappAddress: PublicKey;
  let token2Zkapp: MyToken;
  let token2Id: Field;
 
  async function mintToken(
    zkApp: MyToken,
    targetAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    account: PrivateKey
  ) {
    let tx = await Mina.transaction(account, () => {
      AccountUpdate.fundNewAccount(account); // because target hasnt got a valid account yet?
      zkApp.mint(targetAddress,UInt64.from(10000))
      zkApp.sign(zkAppPrivateKey)
    });
    await tx.send();

  }

  async function sendStableCoin(
    zkApp: MyToken,
    account: PrivateKey,
    stableCoinKey: PrivateKey,
    fromKey: PrivateKey,
    fromAddress: PublicKey,
    targetAddress: PublicKey,
    amount: UInt64
  
   
  ) {
    let tx = await Mina.transaction(account, () => {
      zkApp.token.send({
        from: fromAddress,
        to: targetAddress,
        amount: amount,
      });
      AccountUpdate.attachToTransaction(zkApp.self);
      zkApp.sign(stableCoinKey);
    });
    tx.sign([fromKey]);
    await tx.send();
  }
  const storageServerAddress = "http://127.0.0.1:3001"
  
    // this serves as our offchain in memory storage
    let SellOrders: Map<Field, LocalOrder> = new Map<Field, LocalOrder>(); // orderIndex has key

    let sellHead: Field; // local storage of sellHead

    let SellTree: MerkleTree;
    function addNewSellOrder(newOrder: LocalOrder) {
      newOrder.order.isSell.assertTrue();

      //expect SellOrders to not contain newOrderHash
      const newOrderIndex = newOrder.orderIndex;
      expect(SellOrders.get(newOrderIndex)).toBeFalsy;
      // console.log("currentSellHead",sellHead,sellHead.equals(Field(0)))
      if (sellHead == Field(0)) {
        // sellHead is empty, so we can assume nextIndex and PrevHash dont have to be handled
        console.log('sellHead is empty');
        sellHead = newOrder.orderIndex;
        SellOrders.set(sellHead, newOrder);
      } else {
        console.log('sellHead is not empty', sellHead);
        const sellHeadPrice = getOrderPriceFromIndex(sellHead);
        if (sellHeadPrice == undefined) {
          throw 'sellHeadPrice not supposed to happen';
        }
        const newOrderPrice = newOrder.order.orderPrice;
        let sellHeadOrder = SellOrders.get(sellHead);
        if (sellHeadOrder == undefined) {
          throw 'sellHeadOrder not supposed to happen';
        }
        if (sellHeadPrice.gt(newOrderPrice).toBoolean()) {
          console.log(
            'newOrder is cheaper then head, so we replace head with newOrder',
            sellHeadPrice,
            newOrderPrice
          );
          sellHeadPrice.assertGt(newOrderPrice);
          newOrder.nextIndex = sellHead; // since we are replacing sellHead, our nextIndex would be sellHead
          SellOrders.set(newOrderIndex, newOrder); // store newOrder in local memory
          sellHeadOrder.prevIndex = newOrderIndex;

          SellOrders.set(sellHead, sellHeadOrder); // old sellhead's prevIndex would be our new order
          sellHead = newOrderIndex; // replace sellHead
        } else {
          console.log(
            'sellHead price is lower then newOrderprice',
            sellHeadPrice,
            newOrderPrice
          );
          newOrderPrice.assertGte(sellHeadPrice);
          const sellHeadNext = getNextIndex(sellHead);
          if (sellHeadNext == undefined) {
            throw 'sellHeadNext undefined not supposed to happen';
          } else if (sellHeadNext == Field(0)) {
            // sellHead doesnt have a next, we're next
            injectSellOrderAfter(newOrder, sellHead);
          } else {
            const whereToInject: Field | undefined =
              findSellIndexToInsertAfter(newOrder, sellHeadNext);
            console.log('whereToInject', whereToInject);
            if (whereToInject == undefined) {
              throw 'whereToInject undefined not supposed to happen';
            }
            injectSellOrderAfter(newOrder, whereToInject);
          }
        }
      }
    }

    function getEmptySellOrderIndex() {
      let returnIndex
      let i = BigInt(1);
      while (returnIndex == undefined) {
        const currentIndexOrder = getSellOrderAtIndex(Field(i))
        if (currentIndexOrder == undefined) {
          returnIndex = i;
        }
        i++;
      }
      return returnIndex
    }
    function injectSellOrderAfter(newOrder: LocalOrder, injectIndex: Field) {
      // i want to inject new order, after inject next

      console.log('injectSellOrderAfter called', injectIndex);

      // deal with newOrders indexes
      const injectsNextIndex = getNextIndex(injectIndex);
      if (injectsNextIndex !== undefined && injectsNextIndex !== Field(0)) {
        newOrder.nextIndex = injectsNextIndex;

        // deal with inject's next prev which is me
        const injectNextOrder = SellOrders.get(injectsNextIndex);
        if (injectNextOrder == undefined) {
          throw 'injectSellOrderAfter injectNextOrder undefined';
        }
        injectNextOrder.prevIndex = newOrder.orderIndex;
        SellOrders.set(injectNextOrder.orderIndex, injectNextOrder);
      }
      newOrder.prevIndex = injectIndex; // new prev is inject
      SellOrders.set(newOrder.orderIndex, newOrder);
      // deal with Injectindex's indexes

      const injectOrder = SellOrders.get(injectIndex);
      if (injectOrder == undefined) {
        throw 'injectSellOrderAfter injectOrder undefined';
      }
      injectOrder.nextIndex = newOrder.orderIndex; // inject's next is me. dont touch his prev
      SellOrders.set(injectOrder.orderIndex, injectOrder);
    }
    function findSellIndexToInsertAfter(
      newOrder: LocalOrder,
      currentIndex: Field
    ): Field | undefined {
      if (currentIndex == Field(0)) {
        throw 'findSellIndexToInsertAfter deal with null index before this function';
      }
      const newOrderPrice = newOrder.order.orderPrice;
      console.log(
        'findSellIndexToInsertAfter currentIndex',
        currentIndex,
        newOrderPrice
      );
      let currentIndexPrice = getOrderPriceFromIndex(currentIndex);
      if (currentIndexPrice == undefined) {
        throw 'findSellIndexToInsertAfter invalid currentIndex';
      }
      console.log(
        'findSellIndexToInsertAfter issmallerthen',
        newOrderPrice,
        currentIndexPrice
      );
      if (newOrderPrice.lt(currentIndexPrice)) {
        // neworder is under current index, so it should be insert here BEFORE currentIndex
        console.log('newOrder is lt currentIndex');
        return getPrevIndex(currentIndex); // returns prev index, so we insert after to make it easier to code
      } else {
        console.log('newOrder is gte currentIndex');
        const nextIndex = getNextIndex(currentIndex);
        if (nextIndex == undefined || nextIndex == Field(0)) {
          // nextIndex doesnt exist, so means we want to add AFTER current index
          return currentIndex;
        } else {
          console.log('gona loop findSellIndexToInsertAfter', nextIndex);
          return findSellIndexToInsertAfter(newOrder, nextIndex);
        }
      }
    }
    function getOrderPriceFromIndex(orderIndex: Field) {
      return SellOrders.get(orderIndex)?.order.orderPrice;
    }

    function getOrderPrice(order: LocalOrder) {
      return SellOrders.get(order.orderIndex)?.order.orderPrice;
    }

    function getOrderAmount(order: LocalOrder) {
      return SellOrders.get(order.orderIndex)?.order.orderAmount;
    }
    function getNextIndex(orderHead: Field) {
      return SellOrders.get(orderHead)?.nextIndex;
    }

    function getPrevIndex(orderHead: Field) {
      return SellOrders.get(orderHead)?.prevIndex;
    }

    function getOrderedSellOrderBook(): LocalOrder[] {
      let sellOrders: LocalOrder[] = [];
      if (sellHead == Field(0)) {
        console.log('getSellOrderBook sellHead is empty');
        return sellOrders;
      } else {
        const sellHeadOrder = SellOrders.get(sellHead);
        if (sellHeadOrder == undefined) {
          throw 'getSellOrderBook sellHead has no order';
        }

        sellOrders.push(sellHeadOrder);
        let nextHead = getNextIndex(sellHead);
        while (nextHead !== undefined && nextHead !== Field(0)) {
          const nextHeadOrder = SellOrders.get(nextHead);
          if (nextHeadOrder == undefined) {
            throw 'getSellOrderBook nextHeadOrder has no order';
          }
          sellOrders.push(nextHeadOrder);
          nextHead = getNextIndex(nextHead);
        }

        return sellOrders;
      }
    }

    function getSellOrderbook() : LocalOrder[] {
      let sellOrders: LocalOrder[] = [];
      let i = 1;
      let currentOrder = getSellOrderAtIndex(Field(i));
      while (currentOrder !== undefined) {
        sellOrders.push(currentOrder)
        i++;
        currentOrder = getSellOrderAtIndex(Field(i));
      }
      return sellOrders
    }

    function getSellOrderAtIndex(index: Field): (LocalOrder|undefined) {
      return SellOrders.get(index);
    }

    async function initState(
      signerKey: PrivateKey,
      StorageServerPublicKey: PublicKey,
      _Token1: PublicKey,
      _Token2: PublicKey
    ) {
      let tx = await Mina.transaction(signerKey, () => {
        zkApp.initState(StorageServerPublicKey,_Token1,_Token2);
      });
      await tx.prove();
      tx.sign([signerKey]);
      await tx.send();
    } 

    async function updateSellRoot(
    signerKey: PrivateKey,
    newRoot: Field,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
    ) {
      let tx = await Mina.transaction(signerKey, () => {
        zkApp.TMPupdateSellRoot(  
          newRoot,
          storedNewRootNumber,
          storedNewRootSignature);
      });
      await tx.prove();
      tx.sign([signerKey]);
      await tx.send();
    } 

    async function addNewOrderToSellTree(leafIndex: Field,newOrder: Order) {
      // verify that Tree is synced with OrderBook
      const treeRoot = zkApp.SellTreeRoot.get();
      expect(SellTree.getRoot()).toStrictEqual(treeRoot);

      // get old leafIndex witness before insert
      const leafWitness = new MyMerkleWitness(SellTree.getWitness(leafIndex.toBigInt()));
      const priorLeafData = getSellOrderAtIndex(leafIndex);
      if (priorLeafData) {
        // order is already in db
        // going to handle db orders tog, so assume its not in here to begin with
        // useful to handle updates in same method
        throw "not supposed to already be in db per current design";
      } else {
        // order is not already in current db
        //add to tree
        const newOrderHash = newOrder.hash()
        SellTree.setLeaf(leafIndex.toBigInt(),newOrderHash);
        // lets try to reconstuct new tree from old root and path
        //old root = treeRoot
        const newWitness =  new MyMerkleWitness(SellTree.getWitness(leafIndex.toBigInt()));
        if (newWitness.equals(leafWitness).toBoolean()) {
          console.log("bah wtf is this happening newWitness",JSON.stringify(newWitness,null,4))
          console.log("leafWitness",JSON.stringify(leafWitness,null,4))
          throw "bah"
        }
        // expect(newWitness).toStrictEqual(leafWitness)
        const newRoot = SellTree.getRoot();
        const update: LeafUpdate = {
            leaf: [Field(0)],
            leafIsEmpty: Bool(true),
            newLeaf: [newOrderHash],
            newLeafIsEmpty: Bool(false),
            leafWitness: newWitness,
        }
        
        
        assertRootUpdateValid(treeRoot,update,newRoot); // replicating onchain check , technically unneeded
        console.log("onchain root",treeRoot.toString())
        
        // await updateSellRoot(deployer,updates[0],newRoot)
        // // console.log("newRoot i wanna use",newRoot.toString())

        // const updatedTreeRoot = zkApp.SellTreeRoot.get();

        // updatedTreeRoot.assertEquals(newRoot);
        // const newLocalOrder: LocalOrder = {
        //   orderIndex: getEmptySellOrderIndex(), //leave 0 for null value
        //   order: newOrder,
        //   nextIndex: Field(0), //leave 0 for null value
        //   prevIndex: Field(0), //leave 0 for null value

        // }
        // addNewSellOrder(newLocalOrder)

      }


  }

  function assertRootUpdateValid(root: Field, update: LeafUpdate, storedNewRoot: Field)  {
    let emptyLeaf = Field(0);
    var currentRoot = root;
    // console.log("got root",root.toString())
    // console.log("got storedNewRoot",storedNewRoot.toString())
    if (root.equals(storedNewRoot).toBoolean()) {
      throw "empty root update"
    }
    let updates = [update]
    for (var i = 0; i < updates.length; i++) {
        const { leaf, leafIsEmpty, newLeaf, newLeafIsEmpty, leafWitness } = updates[i];
        // check the root is starting from the correct state
        let leafHash = Circuit.if(leafIsEmpty, emptyLeaf, Poseidon.hash(leaf));
        leafWitness.calculateRoot(leafHash).assertEquals(currentRoot);
        // calculate the new root after setting the leaf
        let newLeafHash = Circuit.if(newLeafIsEmpty, emptyLeaf, Poseidon.hash(newLeaf));
        currentRoot = leafWitness.calculateRoot(newLeafHash);
        // console.log("latest currentRoot",currentRoot.toString())
    }
    if (currentRoot.equals(storedNewRoot).toBoolean()) {
      return;
    }
    console.log("assertRootUpdateValid failed",currentRoot.toString(),storedNewRoot.toString(),JSON.stringify(updates,null,4))
    throw "RootUpdate not valid"
  };
  async function postData(height: number,orders: LocalOrder[],dontUpdateSellRoot: Bool): Promise<[Field,Signature]> {

    // need to convert to items: Array<[string, string[]]
    // console.log("postData called",orders[0].toJSON(),orders[0].hash())
    const items = convertOrdersIntoItems(orders);
    // console.log("items",JSON.stringify(items,null,4))
    
    const postRes = await fetch(storageServerAddress + "/data", {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        height,
        items,
        zkAppAddress: zkAppAddress.toJSON()
      })
    }).then((res) => res.json())

    // handle local SellTree data update
    
    const newRootNumber = Field.fromJSON(postRes.result[0])
    const rootSignature = Signature.fromFields(postRes.result[1].map((s: string) => Field.fromJSON(s)))
    if (!(dontUpdateSellRoot.toBoolean())) {
      // we are setting this tree and actually passing that tree to this function to begin with in the other case
      expect(zkApp.SellTreeRoot.get()).toStrictEqual(SellTree.getRoot())
      orders.forEach((order) => {
        SellTree.setLeaf(order.orderIndex.toBigInt(),Poseidon.hash(order.toFields()))
        if (order.orderIndex !== Field(0)) {
          SellOrders.set(order.orderIndex,order)
        }
      })
      await updateSellRoot(
        deployer,
        SellTree.getRoot(),
        newRootNumber,
        rootSignature
      )
      expect(zkApp.SellTreeRoot.get()).toStrictEqual(SellTree.getRoot())
    }

    
    return [newRootNumber,rootSignature]
  }

  async function getData(root: string) {
    // getData will fail if zkAppAddress hasnt been init
    
    const data = await fetch(storageServerAddress + `/data?root=${root}&zkAppAddress=${zkAppAddress.toJSON()}`).then((res) => res.json())
    // console.log("getData got data",JSON.stringify(data,null,4))
    if (data.items) {
      return convertItemsIntoOrders(data.items)
    }
    // throw errors upwards
    return data
  }
  function convertMerkleArrayToIdex2Fields(orders: LocalOrder[]) {
    const idx2fields = new Map<Field, LocalOrder>();
    orders.forEach((order) => {
      idx2fields.set(order.orderIndex, order);
    });
    return idx2fields
  }
  function getEmptyMerkleArray(height: number): LocalOrder[]{
  
    let emptyTreeArray: LocalOrder[] = []
    // we keep  orderIndex for 0 as null address. do not store any orders at index0

    // so we have to store next/prev indexes, because it carries the 'time' aspect of the price-time equation and isnt avail in order.
    // we could directly just muck with the orderIndex actually, but it'll be harder to verify on chain??
    // just gona implement linked list first then see how it performs
    const emptyOrderTemplate = new LocalOrder({
      orderIndex: Field(0),
      order: new Order({
        maker: PublicKey.empty(),
        orderAmount: Field(0),
        orderPrice: Field(0),
        isSell: Bool(false)
      }),
      nextIndex: Field(0),
      prevIndex: Field(0)
    })


    expect(emptyOrderTemplate.order.maker.toJSON()).toStrictEqual("B62qiTKpEPjGTSHZrtM8uXiKgn8So916pLmNJKDhKeyBQL9TDb3nvBG") // are we sure this is it?

    for (let i=1;i<=height;i++) {
      // dont give them any indexes
      // const tmpOrder = new LocalOrder({
      //   orderIndex: Field(i),
      //   order: new Order({
      //     maker: PublicKey.empty(),
      //     orderAmount: Field(0),
      //     orderPrice: Field(0),
      //     isSell: Bool(false)
      //   }),
      //   nextIndex: Field(0),
      //   prevIndex:  Field(0)
      // })
      emptyTreeArray.push(emptyOrderTemplate)
    }
    return emptyTreeArray
  }

  function convertOrdersIntoItems(orders:LocalOrder[] ): Array<[string,Field[]]> {
    return orders.map((order) => {
      return [order.orderIndex.toString(),order.toFields()]
    })
  } 

  function convertItemsIntoOrders(items: Array<[string,string[]]>): LocalOrder[] {
    // items has extra item[0] thjat is replicated in LocalOrder.orderIndex
    return items.map((item) => {
      return new LocalOrder({
        orderIndex: Field(item[1][0]),
        order: new Order({
          maker: PublicKey.from({
            x: Field(item[1][1]),
            isOdd: Bool(item[1][2] == "1")
          }),
          orderAmount: Field(item[1][3]),
          orderPrice: Field(item[1][4]),
          isSell: Bool(item[1][5] == "1")
        }),
        nextIndex: Field(item[1][6]),
        prevIndex: Field(item[1][7])
      })
    })
  }

  function getTreeRootFromMerkleArray(height: number, orders:LocalOrder[]) {
    console.log("getTreeRootFromMerkleArray called")

    // const idx2fields = new Map<bigint, Field[]>();

    // fieldItems.forEach(([index, fields]) => {
    //   idx2fields.set(index, fields);
    // });
    // console.log("idx2fields set",idx2fields)
    const tree = new MerkleTree(height);
  
    for (let order of orders) {
      // console.log("orders loop",order)
      tree.setLeaf(order.orderIndex.toBigInt(),Poseidon.hash(order.toFields()))
    }

    if (orders.length > 2 ** (height - 1)) {
      throw "too many items for height"
    }
    return tree.getRoot().toString()
  }

  function getCheapestSellOrder() {
    // 0n is unused, always start from 1n 
    let currentCheapestOrder: any = undefined;
    SellOrders.forEach((order) => {
      if (order.orderIndex.isZero().toBoolean()) {
        return
      }
      if (currentCheapestOrder == undefined) {
        currentCheapestOrder = order
      } else if (order.order.orderPrice < currentCheapestOrder.order.orderPrice) {
        currentCheapestOrder = order
      }
      
    })
    return currentCheapestOrder
  }

     

  async function matchBuyOrderToSellTree(signerKey: PrivateKey,order: Order) {
    const currentCheapestOffer = getCheapestSellOrder();
    if (currentCheapestOffer == undefined) {
      console.error("Cant find sell order to match")
      return { error: "no sell order to match"}
    }
    if (order.orderPrice < currentCheapestOffer.order.orderPrice) {
      return {error : "cheapest offer:" + currentCheapestOffer.order.orderPrice.toString()}
    }


    // only support entire fills for now
    if (order.orderAmount < currentCheapestOffer.order.orderAmount) {
      return { error: "do not support yet"}
    }

    // we need to delete the fill from localorders and get a witness for that
    
    SellOrders.delete(currentCheapestOffer.orderIndex)
    SellTree.setLeaf(currentCheapestOffer.orderIndex.toBigInt(),Field(0))
    console.log("matchBuyOrderToSellTree SellOrders",SellOrders)
    const currentSellOrderBook = getSellOrderbook()
    console.log("currentSellOrderBook",currentSellOrderBook)
    const [newRootNumber, rootSignature] = await postData(SellTree.height,currentSellOrderBook,Bool(true))

    await fillBuyOrder1(
      signerKey,
      order,
      currentCheapestOffer,
      new MyMerkleWitness(SellTree.getWitness(currentCheapestOffer.orderIndex.toBigInt())),
      SellTree.getRoot(),
      newRootNumber,
      rootSignature
    )

  }
  async function fillBuyOrder1(
      signerKey: PrivateKey,
      order: Order,
      fill: LocalOrder,
      witness: MyMerkleWitness,
      newRoot: Field,
      storedNewRootNumber: Field,
      storedNewRootSignature: Signature
    ) {
      let tx = await Mina.transaction(signerKey, () => {
        zkApp.fillBuyOrder1(order,fill,witness,newRoot,storedNewRootNumber,storedNewRootSignature);
      });
      await tx.prove();
      tx.sign([signerKey]);
      await tx.send();
    } 
  beforeEach(async () => {
    await isReady;
    let Local = Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);
    deployer = Local.testAccounts[0].privateKey;
    alicePrivateKey = Local.testAccounts[1].privateKey;
    bobPrivateKey = Local.testAccounts[2].privateKey;
    janePrivateKey = Local.testAccounts[3].privateKey;
    tomPrivateKey = Local.testAccounts[4].privateKey;


    
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new OrderBook(zkAppAddress);
    await deploy(zkApp, zkAppPrivateKey, deployer);
    SellOrders = new Map<Field, LocalOrder>();
    sellHead = Field(0);
    SellTree = new MerkleTree(8);
    SellTree.fill([Field(0)]);
    // use deployer as storage server
    storageServerPublicKey = PublicKey.fromBase58(
      await fetch(storageServerAddress + "/publicKey")
      .then((res) => res.json()).then((res) => res.serverPublicKey58)
      .catch((err) => {
        throw err
      })
    )


    token1ZkappKey = PrivateKey.random();
    token1ZkappAddress = token1ZkappKey.toPublicKey();
    token1Zkapp = new MyToken(token1ZkappAddress);
    token1Id = token1Zkapp.token.id;
    await deployStableCoin(token1Zkapp,token1ZkappKey,deployer)


    token2ZkappKey = PrivateKey.random();
    token2ZkappAddress = token2ZkappKey.toPublicKey();
    token2Zkapp = new MyToken(token2ZkappAddress);
    token2Id = token2Zkapp.token.id;
    await deployStableCoin(token2Zkapp,token2ZkappKey,deployer)


    await initState(deployer,storageServerPublicKey,token1ZkappAddress,token2ZkappAddress)


  });

  afterAll(() => {
    setTimeout(shutdown, 0);
  });

  describe.only('Tokens',() => {
    test('deployed token contract exists in the ledger', () => {
      expect(Mina.getAccount(token1ZkappAddress, token1Id)).toBeDefined();
      const totalAmountInCirculation = token1Zkapp.totalAmountInCirculation.get();
      expect(totalAmountInCirculation.toBigInt()).toEqual(10_000n)
      expect(
        Mina.getBalance(token1ZkappAddress,token1Id).toBigInt()
      ).toEqual(10_000n)
    });
    test('create a valid token with a different parentTokenId', async () => {
      const newToken =  new MyToken(zkAppAddress,token1Id);
      expect(newToken.tokenId).toEqual(token1Id)

    });
    test('can mint and transfer stableCoin', async () => {
      await mintToken(token1Zkapp,alicePrivateKey.toPublicKey(),token1ZkappKey,deployer)
      expect(
        Mina.getBalance(alicePrivateKey.toPublicKey(),token1Id).toBigInt()
      ).toEqual(10_000n)

      await mintToken(token1Zkapp,bobPrivateKey.toPublicKey(),token1ZkappKey,deployer)
      expect(
        Mina.getBalance(bobPrivateKey.toPublicKey(),token1Id).toBigInt()
      ).toEqual(10_000n)

      await sendStableCoin(
        token1Zkapp,
        deployer,
        token1ZkappKey,
        alicePrivateKey,
        alicePrivateKey.toPublicKey(),
        bobPrivateKey.toPublicKey(),
        UInt64.from(100)
        )
        expect(
          Mina.getBalance(alicePrivateKey.toPublicKey(),token1Id).toBigInt()
        ).toEqual(9_900n)
  
        expect(
          Mina.getBalance(bobPrivateKey.toPublicKey(),token1Id).toBigInt()
        ).toEqual(10_100n)

    });
  })
  describe('OrderBook()', () => {

  
    it('should deploy', async () => {
      const unfilledHead = zkApp.SellTreeRoot.get();
      expect(unfilledHead).toStrictEqual(new MerkleTree(8).getRoot());

      const SellStorageNumber = zkApp.SellStorageNumber.get()
      expect(SellStorageNumber).toStrictEqual(Field(0))

      const storagePublicKey = zkApp.StorageServerPublicKey.get()
      expect(storagePublicKey).toStrictEqual(deployer.toPublicKey());
    });
    it('should work with offchain storage server', async() => {


      // getting existing tree

      const treeRoot = await zkApp.SellTreeRoot.get()
      expect(treeRoot).toStrictEqual(new MerkleTree(8).getRoot())
      expect(treeRoot).toStrictEqual(SellTree.getRoot())
      console.log("treeRoot",treeRoot.toString())
      // !! post data to server
      expect(await getData(treeRoot.toString())).toStrictEqual({
        error: "no data for address"
      })
      // const localTreeArray = getEmptyMerkleArray(SellTree.height); //depre using an empty LocalStorage
      const localTreeArray = getSellOrderbook()
      
      // // we know its empty, so lets just request store to see if its needed
      const aliceOrder: Order = new Order({
        maker: alicePrivateKey.toPublicKey(),
        orderAmount: Field(100),
        orderPrice: Field(100),
        isSell: Bool(true),
      });
      const aliceLocalOrder: LocalOrder = new LocalOrder({
        orderIndex: Field(1),
        order: aliceOrder,
        nextIndex: Field(0),
        prevIndex: Field(0),
      });

      localTreeArray.push(aliceLocalOrder)
      console.log("SellTree root before add",SellTree.getRoot().toString())
      const oldRootNumber = zkApp.SellStorageNumber.get()
      const [newRootNumber, rootSignature] = await postData(SellTree.height,localTreeArray,Bool(false))
      expect(oldRootNumber.add(1)).toStrictEqual(newRootNumber)
      const localCalculatedRoot2 = getTreeRootFromMerkleArray(SellTree.height,localTreeArray)
      const remoteTreeArray2 = await getData(localCalculatedRoot2)
      expect(remoteTreeArray2).toStrictEqual(localTreeArray)

      // update the orderbook sellHead

      console.log("storageServerPublicKey",storageServerPublicKey.toJSON())
      console.log("SellTree root after add",SellTree.getRoot().toString())
      console.log("rootSignature",rootSignature.toFields().toString())
      expect(rootSignature.verify(storageServerPublicKey,[SellTree.getRoot(),newRootNumber]).toBoolean()).toBe(true)



    });
    it('should be able to fillBuyOrder1', async() => {


      const treeRoot = await zkApp.SellTreeRoot.get()
      const localTreeArray = getSellOrderbook()
      
      // // we know its empty, so lets just request store to see if its needed
      const aliceOrder: Order = new Order({
        maker: alicePrivateKey.toPublicKey(),
        orderAmount: Field(100),
        orderPrice: Field(100),
        isSell: Bool(true),
      });
      const aliceLocalOrder: LocalOrder = new LocalOrder({
        orderIndex: Field(1),
        order: aliceOrder,
        nextIndex: Field(0),
        prevIndex: Field(0),
      });

      localTreeArray.push(aliceLocalOrder)
      const oldRootNumber = zkApp.SellStorageNumber.get()
      const [newRootNumber, rootSignature] = await postData(SellTree.height,localTreeArray,Bool(false))
      const localCalculatedRoot2 = getTreeRootFromMerkleArray(SellTree.height,localTreeArray)
      const remoteTreeArray2 = await getData(localCalculatedRoot2)
      expect(oldRootNumber.add(1)).toStrictEqual(newRootNumber)
      expect(remoteTreeArray2).toStrictEqual(localTreeArray)


      // sellHead needs to be correct
      const bobOrder: Order = new Order({
        maker: bobPrivateKey.toPublicKey(),
        orderAmount: Field(100),
        orderPrice: Field(100),
        isSell: Bool(false),
      })
      const marchOrderRes = await matchBuyOrderToSellTree(bobPrivateKey,bobOrder)
      console.log("marchOrderRes",marchOrderRes)
      expect(marchOrderRes?.error).toBe(undefined)
    });
    

  });
});


async function deploy(
  zkApp: OrderBook,
  zkAppPrivateKey: PrivateKey,
  account: PrivateKey
) {
  let tx = await Mina.transaction(account, () => {
    AccountUpdate.fundNewAccount(account);
    zkApp.deploy();
  });
  await tx.prove();
  // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
  await tx.sign([zkAppPrivateKey]).send();
}


async function deployStableCoin(
  tokenzkApp: MyToken,
  zkAppPrivateKey: PrivateKey,
  account: PrivateKey
) {
  let tx = await Mina.transaction(account, () => {
    let feePayerUpdate = AccountUpdate.createSigned(account);
    feePayerUpdate.balance.subInPlace(Mina.accountCreationFee().mul(1));
    feePayerUpdate.send({
      to: zkAppPrivateKey.toPublicKey(),
      amount: Mina.accountCreationFee(),
    });
    tokenzkApp.deploy();
  });
  await tx.prove();
  tx.sign([zkAppPrivateKey]);
  await tx.send();
}

