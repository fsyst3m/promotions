const fs = require("fs");
const es = require("event-stream");
const _ = require("lodash");
const filePath = `${__dirname}/promotions.txt`;

const createPromtionsFile = async (extension, readFilePath) => {
  console.log("Read file path", readFilePath);
  let skus = [];
  await new Promise((resolve) =>
    fs
      .createReadStream(readFilePath)
      .pipe(es.split(""))
      .pipe(
        es.mapSync((line) => {
          const item = line.split("|")[1];
          return item.split(",");
        })
      )
      .pipe(es.mapSync((line) => skus.push(line)))
      // .on("error", (err) => reject(err))
      .on("end", () => {
        console.log("file read completed");
        resolve();
      })
  );
  let data = {};
  skus.forEach((sku) => {
    const regalo = sku[1];
    const value = sku[0];
    let prevValues = data[regalo] ?? [];
    data = { ...data, [regalo]: [...prevValues, value] };
  });

  return fs.writeFile(
    `${__dirname}/generated-promotions.json`,
    JSON.stringify(data),
    "utf-8",
    (err) => {
      if (err) return console.log("uups");
      console.log("file created");
    }
  );
};

module.exports = createPromtionsFile;
