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
  UInt32
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

  deploy() {
    super.deploy();
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method initState(StorageServerPublicKey: PublicKey) {
    this.StorageServerPublicKey.set(StorageServerPublicKey);
    this.SellStorageNumber.set(Field.zero);
    const emptyTreeRoot = Field("14472842460125086645444909368571209079194991627904749620726822601198914470820");
    //precalculated empty merkle tree of LocalOrder[] height 8
    this.SellTreeRoot.set(emptyTreeRoot);
  }
  @method TMPupdateSellRoot(
    newRoot: Field,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
  ) {
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
}
