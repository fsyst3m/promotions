const getReportSKUs = require("../utils/readFile");
const request = require("request");
const Promise = require("bluebird");
const mapURL = {
  bySKU: "http://localhost:5000/mdco/products/by-sku/",
};
const createReport = async (isMkp = false) => {
  const path = `${__dirname}/${isMkp ? "skusmercado.txt" : "skusripley.txt"}`;

  getReportSKUs(path);
};

module.exports = createReport;
