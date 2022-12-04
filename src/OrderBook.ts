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
  OffChainStorage,
  Update,
  MerkleWitness8,
} from 'experimental-zkapp-offchain-storage';

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
  hash(): Field {
    const orderHash = Poseidon.hash([
      ...this.order.maker.toFields(),
      this.order.orderAmount,
      this.order.orderPrice,
      this.order.isSell.toField(),
    ])
    return Poseidon.hash([
      this.orderIndex,
      orderHash,
      this.nextIndex,
      this.prevIndex
    ])
  }
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

  toStringArray(): string[] {
    return [
      this.orderIndex.toString(),
      this.order.maker.toJSON(),
      this.order.orderAmount.toString(),
      this.order.orderPrice.toString(),
      this.order.isSell.toField().toString(),
      this.nextIndex.toString(),
      this.prevIndex.toString()
    ]
  }
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
  @state(PublicKey) storageServerPublicKey = State<PublicKey>();
  @state(Field) sellStorageNumber = State<Field>();
  @state(Field) sellTreeRoot = State<Field>();

  deploy() {
    super.deploy();
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method initState(storageServerPublicKey: PublicKey) {
    this.storageServerPublicKey.set(storageServerPublicKey);
    this.sellStorageNumber.set(Field.zero);
    const emptyTreeRoot = new MerkleTree(8).getRoot();
    this.sellTreeRoot.set(emptyTreeRoot);
  }

  @method updateSellRoot(
    update: LeafUpdate,
    newRoot: Field 
  ) {

    // is there a real need to compare newRoot? we can always calculate it...
    this.assertRootUpdateValid(update,newRoot)
    this.sellTreeRoot.set(newRoot);
  }

  @method assertRootUpdateValid(update: LeafUpdate, storedNewRoot: Field)  {
    let emptyLeaf = Field(0);
    let currentRoot = this.sellTreeRoot.get();
    this.sellTreeRoot.assertEquals(currentRoot);
    let updates = [update]; // can optimize the loop away if we really cant send multiple
    // dooesnt work, dont check for now
    // Circuit.if(
    //   root.equals(storedNewRoot),
    //   (() => {
    //     // we want to kill it here, gona just use another assert cos i dont know how to do it raw
    //     Circuit.log("root equals storedNewRoot",root,storedNewRoot)
    //     return root.assertGt(storedNewRoot)
    //   })(),
    //   (() => {
    //     // do nothing here
    //     return;
    //   })()
    // )
    Circuit.log("onchain assertRootUpdateValid currentRoot",currentRoot)
    for (var i = 0; i < updates.length; i++) {
        const { leaf, leafIsEmpty, newLeaf, newLeafIsEmpty, leafWitness } = updates[i];
        // check the root is starting from the correct state
        let leafHash = Circuit.if(leafIsEmpty, emptyLeaf, Poseidon.hash(leaf));
        leafWitness.calculateRoot(leafHash).assertEquals(currentRoot);
        // calculate the new root after setting the leaf
        let newLeafHash = Circuit.if(newLeafIsEmpty, emptyLeaf, Poseidon.hash(newLeaf));
        currentRoot = leafWitness.calculateRoot(newLeafHash);
        Circuit.log("onchain latest currentRoot",currentRoot)
    }
    Circuit.log("currentRoot equals storedNewRoot",currentRoot,storedNewRoot)
    currentRoot.assertEquals(storedNewRoot)
  }

  @method hashOrder(order: Order) {
    return order.hash()
  }
}
