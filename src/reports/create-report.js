const fs = require("fs");

const writeToFile = (data, reportName) => {
  const filePath = __dirname + "/reporte-" + reportName + ".txt";
  return fs.appendFile(filePath, `${data}\r\n`, (err) => {
    if (err) console.error(err);
  });
};

module.exports = writeToFile;
