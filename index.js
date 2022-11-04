const express = require("express");
const createReport = require("./src/jobs/create-report");
const createPromotionsFile = require("./src/utils/create-promotions");
const app = express();
const PORT = process.env.PORT;

const routes = require("./src/routes");

app.use(routes);
const promotionsPath = `${__dirname}/src/utils/promos-pe.txt`;

const runJob = (type) => {
  switch (type) {
    case "productos-ripley":
      return createReport(false);
    case "productos-MKP":
      return createReport(true);
    case "promotions":
      return createPromotionsFile("txt", promotionsPath);
    default:
      return () => null;
  }
};

app.use("/job/:name", (req, res, send) => {
  const job = req.params.name;
  runJob(job);
});

runJob(process.env.JOB);

app.listen(PORT, () => {
  console.log(`listening port: ${PORT}`);
});
