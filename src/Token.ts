import {
    shutdown,
    isReady,
    State,
    state,
    UInt64,
    Bool,
    SmartContract,
    Mina,
    PrivateKey,
    AccountUpdate,
    method,
    PublicKey,
    DeployArgs,
    Permissions,
    Token,
    VerificationKey,
    Field,
    Experimental,
    Int64,
  } from 'snarkyjs';

  export { MyToken };
  class MyToken extends SmartContract {
    SUPPLY = UInt64.from(100_000);
    @state(UInt64) totalAmountInCirculation = State<UInt64>();

    deploy(args?: DeployArgs) {
        super.deploy(args);
        this.setPermissions({
          ...Permissions.default(),
          editState: Permissions.proofOrSignature(),
          send: Permissions.proof(),
          receive: Permissions.proof(),
        });
    }

    /** This deploy method lets a another token account deploy their zkApp and verification key as a child of this token contract.
     * This is important since we want the native token id of the deployed zkApp to be the token id of the token contract.
     */
    @method deployZkapp(address: PublicKey, verificationKey: VerificationKey) {
        let tokenId = this.token.id;
        let zkapp = AccountUpdate.defaultAccountUpdate(address, tokenId);
        this.approve(zkapp);
        AccountUpdate.setValue(zkapp.update.permissions, {
        ...Permissions.default(),
        send: Permissions.proof(),
        });
        AccountUpdate.setValue(zkapp.update.verificationKey, verificationKey);
        zkapp.sign();
    }

    @method init() {
        super.init();
        let address = this.self.body.publicKey;
        let receiver = this.token.mint({
          address,
          amount: 10000,
        });
        receiver.account.isNew.assertEquals(Bool(true));
        this.balance.subInPlace(Mina.accountCreationFee());
        this.totalAmountInCirculation.set(new UInt64(10000));
    }
    @method mint(receiverAddress: PublicKey, amount: UInt64) {
        let totalAmountInCirculation = this.totalAmountInCirculation.get();
        this.totalAmountInCirculation.assertEquals(totalAmountInCirculation);
        let newTotalAmountInCirculation = totalAmountInCirculation.add(amount);
        newTotalAmountInCirculation.value.assertLte(
          this.SUPPLY.value,
          "Can't mint more than the total supply"
        );
        this.token.mint({
          address: receiverAddress,
          amount,
        });
        this.totalAmountInCirculation.set(newTotalAmountInCirculation);
      }
      @method burn(receiverAddress: PublicKey, amount: UInt64) {
        let totalAmountInCirculation = this.totalAmountInCirculation.get();
        this.totalAmountInCirculation.assertEquals(totalAmountInCirculation);
        let newTotalAmountInCirculation = totalAmountInCirculation.sub(amount);
        totalAmountInCirculation.value.assertGte(
          UInt64.from(0).value,
          "Can't burn less than 0"
        );
        this.token.burn({
          address: receiverAddress,
          amount,
        });
        this.totalAmountInCirculation.set(newTotalAmountInCirculation);
      }

    @method approveTransferCallback(
        senderAddress: PublicKey,
        receiverAddress: PublicKey,
        amount: UInt64,
        callback: Experimental.Callback<any>
      ) {
        let layout = AccountUpdate.Layout.NoChildren; // Allow only 1 accountUpdate with no children
        let senderAccountUpdate = this.approve(callback, layout);
        let negativeAmount = Int64.fromObject(
          senderAccountUpdate.body.balanceChange
        );
        negativeAmount.assertEquals(Int64.from(amount).neg());
        let tokenId = this.token.id;
        senderAccountUpdate.body.tokenId.assertEquals(tokenId);
        senderAccountUpdate.body.publicKey.assertEquals(senderAddress);
        let receiverAccountUpdate = Experimental.createChildAccountUpdate(
          this.self,
          receiverAddress,
          tokenId
        );
        receiverAccountUpdate.balance.addInPlace(amount);
      }
      // @method setValidTokenSymbol(tokenSymbol: string) {
      //   this.tokenSymbol.set(tokenSymbol);
      // }
  }