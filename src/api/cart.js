const baseURL = process.env.TRANSACTIONS__BASE_URL;
const X_API_KEY = process.env.X_API_KEY;
const request = require("request-promise");

const requestIntance = request.defaults({
  method: "GET",
  baseUrl: baseURL,
  headers: { "x-api-key": X_API_KEY },
  json: true,
});

const makeCartRequest = async (url, method, data) => {
  try {
    const res = await requestIntance({
      url,
      method,
      body: data,
    });
    return res;
  } catch (err) {
    throw err;
  }
};

const map = {
  add: (nkmrTra) => `${nkmrTra}/item`,
};
const addToCart = async (cartId, { sku, quantity }) =>
  makeCartRequest(map.add(cartId), "POST", {
    sku,
    quantity,
  });

module.exports = {
  addToCart,
};
