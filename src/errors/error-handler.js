const _errors = {
  Mirakl: {
    InvalidOfferId: { message: "Invalid marketplace offer id" },
    InactiveOffer: { message: "Offer is currently not active" },
    OutOfStock: { message: "Product has no available offers" },
    NotFound: { message: "Product not found on mirakl" },
  },
};

class Error {
  constructor(name, type) {
    this.errorName = name;
  }
}
