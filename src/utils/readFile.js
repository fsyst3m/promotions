const fs = require("fs");
const es = require("event-stream");

const request = require("request-promise");
const Promise = require("bluebird");

const mapURL = {
  bySKU: `http://localhost:${process.env.PORT}/mdco/products/by-sku/`,
};

const makeRequest = async (sku) => {
  const url = `${mapURL.bySKU}${sku}`;
  try {
    const res = await request.get(url);
    return res;
  } catch (err) {
    throw err;
  }
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const getReportSKUs = async (path) => {
  let uniqueSKUS = [];
  let skus = [];
  let index = 0;

  await new Promise((resolve, reject) =>
    fs
      .createReadStream(path)
      .pipe(es.split(""))
      .pipe(
        es.mapSync((line) => {
          const partNumber = line.split("|")[1];
          skus.push(partNumber);
        })
      )
      .on("error", (err) => reject(err))
      .on("end", () => {
        console.log("file read completed");
        uniqueSKUS = [...new Set(skus)];
        resolve();
      })
  );
  console.log(uniqueSKUS.length);
  console.log("starts", new Date());
  // uniqueSKUS.length - 17000;
  const start = 24174;
  console.log("start position", start);
  const ends = start + 1000;
  const arr = uniqueSKUS.slice(start, ends);
  for (sku of arr) {
    await makeRequest(sku);
    console.log("done on ", sku);
    index++;
    console.log(
      "porcentaje: % ",
      parseFloat((index / arr.length) * 100).toFixed(2)
    );
    await sleep(500);
  }
  console.log("Job done", new Date());
  console.log(process.env.JOB);
  console.log(process.env.PORT);
  console.log("end position: [", ends, "]");
};

module.exports = getReportSKUs;
