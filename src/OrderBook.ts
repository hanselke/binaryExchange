import {
  PublicKey,
  Field,
  Bool,
  SmartContract,
  state,
  State,
  method,
  Permissions,
  Struct,
  Signature,
  MerkleWitness,
  MerkleTree,
  Poseidon,
  Circuit,
  UInt32,
  arrayProp
} from 'snarkyjs';
import {
  Update,
  assertRootUpdateValid
} from './offChainStorage';

export { Order, OrderBook, MyMerkleWitness,LeafUpdate, LocalOrder};

class MyMerkleWitness extends MerkleWitness(8) {}
class Order extends Struct({
  maker: PublicKey,
  orderAmount: Field,
  orderPrice: Field,
  isSell: Bool,
}) {
  //can add class methods here

  hash(): Field {
    return Poseidon.hash([
      ...this.maker.toFields(),
      this.orderAmount,
      this.orderPrice,
      this.isSell.toField(),
    ]);
  }
  toJSON() {
    return {
      maker: this.maker.toJSON(),
      orderAmount: this.orderAmount.toString(),
      orderPrice: this.orderPrice.toString(),
      isSell: this.isSell.toBoolean()
    }
  }
}
class LocalOrder extends Struct({
  orderIndex: Field, //leave 0 for null value
  order: Order,
  nextIndex: Field, //leave 0 for null value
  prevIndex: Field, //leave 0 for null value
}) {
  // seems like some magic by defining this, it allows the system to deal with the switching from obj <> JSON ?
  toJSON() {
    return {
      orderIndex: this.orderIndex.toString(),
      order: {
        maker: this.order.maker.toJSON(),
        orderAmount: this.order.orderAmount.toJSON(),
        orderPrice: this.order.orderPrice.toJSON(),
        isSell: this.order.isSell.toBoolean()
      },
      nextIndex: this.nextIndex.toString(),
      prevIndex: this.prevIndex.toString()
    }
  }
  // hash(): Field {
  //   const orderHash = Poseidon.hash([
  //     ...this.order.maker.toFields(),
  //     this.order.orderAmount,
  //     this.order.orderPrice,
  //     this.order.isSell.toField(),
  //   ])
  //   return Poseidon.hash([
  //     this.orderIndex,
  //     orderHash,
  //     this.nextIndex,
  //     this.prevIndex
  //   ])
  // }
  toFields(): Field[] {
    return [
      this.orderIndex,
      ...this.order.maker.toFields(),
      this.order.orderAmount,
      this.order.orderPrice,
      this.order.isSell.toField(),
      this.nextIndex,
      this.prevIndex
    ]
  }

  // toStringArray(): string[] {
  //   return [
  //     this.orderIndex.toString(),
  //     this.order.maker.toJSON(),
  //     this.order.orderAmount.toString(),
  //     this.order.orderPrice.toString(),
  //     this.order.isSell.toField().toString(),
  //     this.nextIndex.toString(),
  //     this.prevIndex.toString()
  //   ]
  // }
}
class LeafUpdate extends Struct({
  leaf: [Field],
  leafIsEmpty: Bool,
  newLeaf: [Field],
  newLeafIsEmpty: Bool,
  leafWitness: MyMerkleWitness
}) {

}
class OrderBook extends SmartContract {
  @state(PublicKey) StorageServerPublicKey = State<PublicKey>();
  @state(Field) SellStorageNumber = State<Field>();
  @state(Field) SellTreeRoot = State<Field>();
  @state(PublicKey) Token1 = State<PublicKey>();
  @state(PublicKey) Token2 = State<PublicKey>();

  deploy() {
    super.deploy();
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method initState(StorageServerPublicKey: PublicKey,_Token1: PublicKey,_Token2: PublicKey) {
    this.StorageServerPublicKey.set(StorageServerPublicKey);
    this.SellStorageNumber.set(Field.zero);
    const emptyTreeRoot = Field("14472842460125086645444909368571209079194991627904749620726822601198914470820");
    //precalculated empty merkle tree of LocalOrder[] height 8
    this.SellTreeRoot.set(emptyTreeRoot);
    this.Token1.set(_Token1);
    this.Token2.set(_Token2);
  }
  @method TMPupdateSellRoot(
    newRoot: Field,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
  ) {
    // need the leaf rollup method to actually do fillOrder?
    let storageServerPublicKey = this.StorageServerPublicKey.get();
    this.StorageServerPublicKey.assertEquals(storageServerPublicKey);
    let SellStorageNumber = this.SellStorageNumber.get();
    this.SellStorageNumber.assertEquals(SellStorageNumber);
    SellStorageNumber.add(1).assertEquals(storedNewRootNumber);
    storedNewRootSignature.verify(storageServerPublicKey, [newRoot,storedNewRootNumber]).assertTrue();
    this.SellTreeRoot.set(newRoot);
    this.SellStorageNumber.set(storedNewRootNumber);
  }
  @method updateSellRoot(
    leafIsEmpty: Bool,
    oldNum: Field,
    num: Field,
    path: MyMerkleWitness,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
  ) {
    const storedRoot = this.SellTreeRoot.get();
    this.SellTreeRoot.assertEquals(storedRoot);

    let storedNumber = this.SellStorageNumber.get();
    this.SellStorageNumber.assertEquals(storedNumber);

    let StorageServerPublicKey = this.StorageServerPublicKey.get();
    this.StorageServerPublicKey.assertEquals(StorageServerPublicKey);
    Circuit.log("OrderBook:updateSellRoot:storedNumber ",storedNumber)
    Circuit.log("OrderBook:updateSellRoot:StorageServerPublicKey ",StorageServerPublicKey)
    Circuit.log("OrderBook:updateSellRoot:storedRoot ",storedRoot)
    Circuit.log("OrderBook:updateSellRoot:path ",path)
    let leaf = [oldNum];
    let newLeaf = [num];

    // newLeaf can be a function of the existing leaf
    // newLeaf[0].assertGt(leaf[0]);

    const updates: Update[] = [
      {
        leaf,
        leafIsEmpty,
        newLeaf,
        newLeafIsEmpty: Bool(false),
        leafWitness: path,
      },
    ];
    Circuit.log("OrderBook:updateSellRoot:updates",updates);
    Circuit.log("OrderBook:updateSellRoot:storedNewRootNumber",storedNewRootNumber);
    const storedNewRoot = assertRootUpdateValid(
      StorageServerPublicKey,
      storedNumber,
      storedRoot,
      updates,
      storedNewRootNumber,
      storedNewRootSignature
    );
    Circuit.log("OrderBook:updateSellRoot:assertRootUpdateValid passed storedNewRoot",storedNewRoot)
    this.SellTreeRoot.set(storedNewRoot);
    this.SellStorageNumber.set(storedNewRootNumber);
  }

  @method fillBuyOrder1(
    order: Order,
    fill: LocalOrder,
    fillWitness: MyMerkleWitness,
    newRoot: Field,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
  ) {
        
    order.isSell.assertFalse();
    fill.order.isSell.assertTrue();
    // if we get both orders, we can tell if they work. without caring about sellHead order.
    // if user wants to do it his problem?

    //however we are probably better off, trying to get the entire offchain server to accept orders to begin with, that just update this hash.
    const sellTreeRoot = this.SellTreeRoot.get();
    this.SellTreeRoot.assertEquals(sellTreeRoot);
    Circuit.log("OrderBook:fillBuyOrder1:order",order);
    Circuit.log("OrderBook:fillBuyOrder1:fill",fill);
    Circuit.log("OrderBook:fillBuyOrder1:sellTreeRoot",sellTreeRoot);

    // validate that fill order and next orders are part of selltree root
    const fillHash: Field = Poseidon.hash(fill.toFields());
    fillWitness.calculateRoot(fillHash).assertEquals(sellTreeRoot)
    // validate that the fill and next orders have the right linkedlist indexes
    // we are matching a buy Order, against a sell LocalOrder.
    // so the sell MUST be sell head, which means that it should have no prev index

    fill.prevIndex.assertEquals(Field(0));

    const orderHasLessThenFill = order.orderAmount.lt(fill.order.orderAmount);
    const fillAmount = Circuit.if(orderHasLessThenFill,fill.order.orderAmount,order.orderAmount);
    fill.order.orderPrice.assertLte(order.orderPrice);
    // we always use fill.order.orderPrice
    Circuit.log("OrderBook:fillBuyOrder1:newRoot",newRoot);
    Circuit.log("OrderBook:fillBuyOrder1:storedNewRootNumber",storedNewRootNumber);
    Circuit.log("OrderBook:fillBuyOrder1:storedNewRootSignature",storedNewRootSignature);
    this.TMPupdateSellRoot(
      newRoot,
      storedNewRootNumber,
      storedNewRootSignature
    )
    // how to do this?

    Circuit.log("OrderBook:fillBuyOrder1 some magic we pay fill his $ and transfer item to order.maker",fillAmount)
    // we need to find a mechanism to delete fill from our Selltree.
    


    


    
    


  }
}
