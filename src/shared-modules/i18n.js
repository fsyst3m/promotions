const accounting = require("accounting");

const definitions = {
  chile: {
    currencyData: {
      country: "chile",
      currency: "CLP",
      thousandSeparator: ".",
      decimalSeparator: ",",
      prefix: "$",
      digits: 0,
      postFormat: (value) => value,
    },
    nationalID: "RUT",
    cartText: "Bolsa de compras",
  },
  peru: {
    currencyData: {
      country: "peru",
      currency: "PEN",
      thousandSeparator: ",",
      decimalSeparator: ".",
      prefix: "S/ ",
      digits: 2,
      postFormat: (value) => value.replace("/.", "/ ").replace(/.00$/, ""),
    },
    nationalID: "DNI",
    cartText: "Bolsa de compra",
  },
};

/**
 * Gets a currency definition, depending on the current country
 */
const countryDefinition = definitions.chile;

/**
 * Formats a number to a country specific money format. The country is pre-bound
 * to the particular environment.
 *
 * If NaN is passed, it will return an empty string (except on development)
 *
 * @param  {Number} input Number to format
 * @return {String}       Number formatted as currency
 */
const formatCurrency = (input) => {
  const parsed = parseFloat(input);

  if (isNaN(parsed)) {
    if (process.env.NODE_ENV !== "development") return "";

    const errorMsg = `NaN given to formatCurrency, received: ${input}`;
    throw new Error(errorMsg);
  }

  const { prefix, digits, thousandSeparator, decimalSeparator, postFormat } =
    countryDefinition.currencyData;

  const formatted = accounting.formatMoney(
    parsed,
    prefix,
    digits,
    thousandSeparator,
    decimalSeparator
  );

  return postFormat(formatted);
};

module.exports = {
  formatCurrency,
  country: process.env.COUNTRY,
  definition: countryDefinition,
  cartText: countryDefinition.cartText,
};
