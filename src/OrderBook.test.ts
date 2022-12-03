import { OrderBook, Order, MyMerkleWitness,LeafUpdate,LocalOrder } from './OrderBook';
import { OffChainStorage, MerkleWitness8 } from 'experimental-zkapp-offchain-storage';
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
  Poseidon
} from 'snarkyjs';
import { fieldEncodings } from 'snarkyjs/dist/node/provable/binable';

const storageServerAddress = "http://127.0.0.1:3001"

describe('OrderBook.js', () => {
  let zkApp: OrderBook,
    zkAppPrivateKey: PrivateKey,
    zkAppAddress: PublicKey,
    deployer: PrivateKey,
    alicePrivateKey: PrivateKey,
    bobPrivateKey: PrivateKey,
    janePrivateKey: PrivateKey,
    tomPrivateKey: PrivateKey;

  
  

    // this serves as our offchain in memory storage
    let SellOrders: Map<Field, LocalOrder> = new Map<Field, LocalOrder>(); // orderIndex has key

    let sellHead: Field = Field(0); // local storage of sellHead

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

    function getSellOrderBook(): LocalOrder[] {
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

    function getSellOrderAtIndex(index: Field): (LocalOrder|undefined) {
      return SellOrders.get(index);
    }

    async function initState(
      signerKey: PrivateKey,
      storageServerPublicKey: PublicKey
    ) {
      let tx = await Mina.transaction(signerKey, () => {
        zkApp.initState(storageServerPublicKey);
      });
      await tx.prove();
      tx.sign([signerKey]);
      await tx.send();
    } 

    async function updateSellRoot(
    signerKey: PrivateKey,
    update: LeafUpdate,
    newRoot: Field 
    ) {
      let tx = await Mina.transaction(signerKey, () => {
        zkApp.updateSellRoot(update,newRoot);
      });
      await tx.prove();
      tx.sign([signerKey]);
      await tx.send();
    } 


    async function addNewOrderToSellTree(leafIndex: Field,newOrder: Order) {
      // verify that Tree is synced with OrderBook
      const treeRoot = zkApp.sellTreeRoot.get();
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

        // const updatedTreeRoot = zkApp.sellTreeRoot.get();

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
    await initState(deployer,deployer.toPublicKey())



  });

  afterAll(() => {
    setTimeout(shutdown, 0);
  });
  describe('OrderBook()', () => {


    it('should deploy', async () => {
      const unfilledHead = zkApp.sellTreeRoot.get();
      expect(unfilledHead).toStrictEqual(new MerkleTree(8).getRoot());

      const sellStorageNumber = zkApp.sellStorageNumber.get()
      expect(sellStorageNumber).toStrictEqual(Field(0))

      const storagePublicKey = zkApp.storageServerPublicKey.get()
      expect(storagePublicKey).toStrictEqual(deployer.toPublicKey());
    });
    it.only('should work with offchain storage server', async() => {
      async function postData(height: number,orders: LocalOrder[]) {

        // get it in Order[] and convert it into Array<[string, Order]>
        
        return await fetch(storageServerAddress + "/data", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            height,
            orders,
            zkAppAddress: zkAppAddress.toJSON()
          })
        }).then((res) => res.json())
      }

      async function getData(root: string) {
        // getData will fail if zkAppAddress hasnt been init
        
        const data = await fetch(storageServerAddress + `/data?root=${root}&zkAppAddress=${zkAppAddress.toJSON()}`).then((res) => res.json())
        if (data.items) {
          return convertMerkleArrayToIdex2Fields(data.items)
        }
        // throw errors upwards
        return data
      }
      function convertMerkleArrayToIdex2Fields(items: Array<[string, string[]]>) {
        const idx2fields = new Map<bigint, Field[]>();
        const fieldItems: Array<[bigint, Field[]]> = items.map((item: any) => {
          const strs = item[1];
          return [
              BigInt(item[0]),
              strs.map((s: any) => Field.fromJSON(s)),
            ]
        })
        fieldItems.forEach(([index, fields]) => {
          idx2fields.set(index, fields);
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
          const tmpOrder = new LocalOrder({
            orderIndex: Field(i),
            order: new Order({
              maker: PublicKey.empty(),
              orderAmount: Field(0),
              orderPrice: Field(0),
              isSell: Bool(false)
            }),
            nextIndex: Field(0),
            prevIndex:  Field(0)
          })
          emptyTreeArray.push(tmpOrder)
        }
        return emptyTreeArray
      }
      function getTreeRootFromMerkleArray(height: number, items: Array<[string, string[]]>) {
        if (height > 256) {
          throw "offchain server doesnt support via hardcode value"
        }
        // const zkAppAddress58: string = zkAppAddress.toJSON()
        const fieldItems: Array<[bigint, Field[]]> = items.map(([idx, strs]) => [
          BigInt(idx),
          strs.map((s) => Field.fromJSON(s)),
        ]);

        const idx2fields = new Map<bigint, Field[]>();

        fieldItems.forEach(([index, fields]) => {
          idx2fields.set(index, fields);
        });
      
        const tree = new MerkleTree(height);
      
        for (let [idx, fields] of idx2fields) {
          tree.setLeaf(BigInt(idx), Poseidon.hash(fields));
        }

        if (items.length > 2 ** (height - 1)) {
          throw "too many items for height"
        }
        return tree.getRoot().toString()
      }

    //   export const get = async (serverAddress, zkAppAddress, height, root, UserXMLHttpRequest = null) => {
    //     const idx2fields = new Map();
    //     const tree = new MerkleTree(height);
    //     if (tree.getRoot().equals(root).toBoolean()) {
    //         return idx2fields;
    //     }
    //     var params = 'zkAppAddress=' + zkAppAddress.toBase58() + '&root=' + root.toString();
    //     const response = await makeRequest('GET', serverAddress + '/data?' + params, null, UserXMLHttpRequest);
    //     const data = JSON.parse(response);
    //     printCaution();
    //     const items = data.items;
    //     const fieldItems = items.map(([idx, strs]) => [
    //         idx,
    //         strs.map((s) => Field.fromJSON(s)),
    //     ]);
    //     fieldItems.forEach(([index, fields]) => {
    //         idx2fields.set(BigInt(index), fields);
    //     });
    //     return idx2fields;
    // };
      // getting existing tree

      const treeRoot = await zkApp.sellTreeRoot.get()
      expect(treeRoot).toStrictEqual(new MerkleTree(8).getRoot())
      expect(treeRoot).toStrictEqual(SellTree.getRoot())
      // !! post data to server
      expect(await getData(treeRoot.toString())).toStrictEqual({
        error: "no data for address"
      })
      const localTreeArray = getEmptyMerkleArray(SellTree.height);
      console.log("localTreeArray",localTreeArray)
      
      await postData(SellTree.height,localTreeArray)

      // ok so now we do not know what the idx2fields and conseuaintly the root hash? 

      // const localCalculatedRoot = getTreeRootFromMerkleArray(SellTree.height,emptyTreeArray)
      // console.log("localCalculatedRoot",localCalculatedRoot)
      // const idx2fields = await getData(localCalculatedRoot)
      // expect(idx2fields).toStrictEqual(convertMerkleArrayToIdex2Fields(emptyTreeArray))

      

      // // we know its empty, so lets just request store to see if its needed
      // const aliceOrder: Order = new Order({
      //   maker: alicePrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(100),
      //   isSell: Bool(true),
      // });
      // const aliceLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(1),
      //   order: aliceOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });

      // emptyTreeArray[0][1] = [aliceOrder.hash()]
      // await postData(SellTree.height,emptyTreeArray)


      // const localCalculatedNewRoot = getTreeRootFromMerkleArray(SellTree.height,emptyTreeArray)
      // const newIdx2fields = await getData(localCalculatedNewRoot)
      // expect(newIdx2fields).toStrictEqual(convertMerkleArrayToIdex2Fields(emptyTreeArray))
      // console.log("newIdx2fields",newIdx2fields)
    })
    it.skip('should not allow not makers to sign orders for makers', async () => {

    });

    it('should be able to store sell orders properly', async () => {


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





      await addNewOrderToSellTree(aliceLocalOrder.orderIndex,aliceOrder)


      expect(getOrderPrice(aliceLocalOrder)).toStrictEqual(Field(100));
      expect(getOrderAmount(aliceLocalOrder)).toStrictEqual(Field(100));
      expect(getSellOrderBook().length).toBe(1);
      expect(getSellOrderBook()[0].order.maker).toStrictEqual(
        alicePrivateKey.toPublicKey()
      );

      // console.log("initial tree root",SellTree.getRoot())
      // console.log("initial ")
      // console.log(" zkApp.sellTreeRoot.get()", zkApp.sellTreeRoot.get())
      // SellTree.setLeaf(aliceLocalOrder.orderIndex, aliceOrder.hash());
      // const initalCommitment = SellTree.getRoot();
      // const witness = new MyMerkleWitness(SellTree.getWitness(aliceLocalOrder.orderIndex))
      // console.log("witness",witness.path,witness.isLeft);
      // console.log("initalCommitment",initalCommitment)
      // await storeNewSellRoot(
      //   alicePrivateKey,
      //   initalCommitment,
      //   aliceOrder,
      //   new MyMerkleWitness(SellTree.getWitness(aliceLocalOrder.orderIndex))
      // );

      //   // index i wanna edit = aliceLocalOrder.orderIndex
      // await updateSellRoot(

      // )
      // // console.log(" zkApp.sellTreeRoot.get()", zkApp.sellTreeRoot.get())
      // zkApp.sellTreeRoot.get().assertEquals(initalCommitment);

      // const bobOrder: Order = new Order({
      //   maker: bobPrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(200),
      //   isSell: Bool(true),
      // });
      // const bobLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(2),
      //   order: bobOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });

      // addNewSellOrder(bobLocalOrder);

      // // console.log("SellOrders",SellOrders)
      // expect(getOrderPrice(bobLocalOrder)).toStrictEqual(Field(200));
      // expect(getOrderAmount(bobLocalOrder)).toStrictEqual(Field(100));
      // // console.log("getSellOrderBook()",getSellOrderBook())
      // expect(getSellOrderBook().length).toBe(2);
      // expect(getSellOrderBook()[0].order.maker).toStrictEqual(
      //   alicePrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[1].order.maker).toStrictEqual(
      //   bobPrivateKey.toPublicKey()
      // );
      // SellTree.setLeaf(bobLocalOrder.orderIndex, bobOrder.hash());
      // const bobCommit = SellTree.getRoot();
      // await storeNewSellRoot(
      //   bobPrivateKey,
      //   bobCommit,
      //   bobOrder,
      //   new MyMerkleWitness(SellTree.getWitness(bobLocalOrder.orderIndex))
      // );
      // zkApp.sellTreeRoot.get().assertEquals(bobCommit);

      // const janeOrder: Order = new Order({
      //   maker: janePrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(150),
      //   isSell: Bool(true),
      // });
      // const janeLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(3),
      //   order: janeOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });

      // addNewSellOrder(janeLocalOrder);
      // // console.log("SellOrders",SellOrders)
      // expect(getOrderPrice(janeLocalOrder)).toStrictEqual(Field(150));
      // expect(getOrderAmount(janeLocalOrder)).toStrictEqual(Field(100));
      // expect(getSellOrderBook().length).toBe(3);
      // expect(getSellOrderBook()[0].order.maker).toStrictEqual(
      //   alicePrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[1].order.maker).toStrictEqual(
      //   janePrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[2].order.maker).toStrictEqual(
      //   bobPrivateKey.toPublicKey()
      // );

      // SellTree.setLeaf(janeLocalOrder.orderIndex, janeOrder.hash());
      // const janeCommit = SellTree.getRoot();
      // await storeNewSellRoot(
      //   janePrivateKey,
      //   janeCommit,
      //   janeOrder,
      //   new MyMerkleWitness(SellTree.getWitness(janeLocalOrder.orderIndex))
      // );
      // zkApp.sellTreeRoot.get().assertEquals(janeCommit);

      // const tomOrder: Order = new Order({
      //   maker: tomPrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(50),
      //   isSell: Bool(true),
      // });
      // const tomLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(4),
      //   order: tomOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });
      // console.log('adding toms sell order');
      // addNewSellOrder(tomLocalOrder);
      // console.log('SellOrders', SellOrders);
      // expect(getOrderPrice(tomLocalOrder)).toStrictEqual(Field(50));
      // expect(getOrderAmount(tomLocalOrder)).toStrictEqual(Field(100));
      // console.log('after tom getSellOrderBook()', getSellOrderBook());
      // expect(getSellOrderBook().length).toBe(4);
      // expect(getSellOrderBook()[0].order.maker).toStrictEqual(
      //   tomPrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[1].order.maker).toStrictEqual(
      //   alicePrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[2].order.maker).toStrictEqual(
      //   janePrivateKey.toPublicKey()
      // );
      // expect(getSellOrderBook()[3].order.maker).toStrictEqual(
      //   bobPrivateKey.toPublicKey()
      // );

      // SellTree.setLeaf(tomLocalOrder.orderIndex, tomOrder.hash());
      // const tomCommit = SellTree.getRoot();
      // await storeNewSellRoot(
      //   tomPrivateKey,
      //   tomCommit,
      //   tomOrder,
      //   new MyMerkleWitness(SellTree.getWitness(tomLocalOrder.orderIndex))
      // );
      // zkApp.sellTreeRoot.get().assertEquals(tomCommit);
    });
    it.skip('should not allow wrong merkle trees to be posted', async () => {



      // const aliceOrder: Order = new Order({
      //   maker: alicePrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(100),
      //   isSell: Bool(true),
      // });

      // const aliceLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(1),
      //   order: aliceOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });

      // addNewSellOrder(aliceLocalOrder);
      // const Tree = new MerkleTree(8);
      // // console.log("initial tree root",SellTree.getRoot())
      // // console.log(" zkApp.sellTreeRoot.get()", zkApp.sellTreeRoot.get())
      // SellTree.setLeaf(aliceLocalOrder.orderIndex, aliceOrder.hash());
      // const initalCommitment = SellTree.getRoot();
      // // console.log("initalCommitment",initalCommitment)
      // // await storeNewSellRoot(
      // //   alicePrivateKey,
      // //   initalCommitment,
      // //   aliceOrder,
      // //   new MyMerkleWitness(SellTree.getWitness(aliceLocalOrder.orderIndex))
      // // );
      // // console.log(" zkApp.sellTreeRoot.get()", zkApp.sellTreeRoot.get())
      // zkApp.sellTreeRoot.get().assertEquals(initalCommitment);


      // // bobUses Fake tree
      // const FakeTree = new MerkleTree(8);
      // const bobOrder: Order = new Order({
      //   maker: bobPrivateKey.toPublicKey(),
      //   orderAmount: Field(100),
      //   orderPrice: Field(200),
      //   isSell: Bool(true),
      // });
      // const bobLocalOrder: LocalOrder = new LocalOrder({
      //   orderIndex: BigInt(2),
      //   order: bobOrder,
      //   nextIndex: Field(0),
      //   prevIndex: Field(0),
      // });

      // addNewSellOrder(bobLocalOrder);
      // FakeSellTree.setLeaf(bobLocalOrder.orderIndex, bobOrder.hash());
      // const bobCommit = FakeSellTree.getRoot();
      // await storeNewSellRoot(
      //   bobPrivateKey,
      //   bobCommit,
      //   bobOrder,
      //   new MyMerkleWitness(FakeSellTree.getWitness(bobLocalOrder.orderIndex))
      // );

      // //bobs commit should not be here
      // zkApp.sellTreeRoot.get().assertEquals(initalCommitment);

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
