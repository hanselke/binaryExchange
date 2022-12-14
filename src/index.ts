import { OrderBook } from './OrderBook.js';


import {
    Update,
    assertRootUpdateValid,
    get,
    requestStore,
    getPublicKey,
    makeRequest,
    mapToTree,
  } from './offChainStorage.js';
  
  export type { Update };
  
  const OffChainStorage = {
    assertRootUpdateValid,
    get,
    requestStore,
    getPublicKey,
    makeRequest,
    mapToTree,
  };
  
  export {
    OffChainStorage,
    OrderBook
  };
