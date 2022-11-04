const _ = require("lodash");
const axios = require("axios");
const slug = require("slug");
const i18n = require("../shared-modules/i18n");
const request = require("request-promise");
const utils = require("../utils");
const writeToFile = require("../reports/create-report");
const Promise = require("bluebird");
const reportName =
  process.env.JOB === "productos-ripley" ? "ripleySkus" : "mercado-productos";

const MIRAKL__AUTH_HEADER = process.env.MIRAKL__AUTH_HEADER;
const MIRAKL__API = process.env.MIRAKL__API;

function camelCaseKeys(obj) {
  if (_.isArray(obj)) return obj;
  return _.mapKeys(obj, (v, key) => _.camelCase(key));
}

/**
 * Recursively camelCases object's attributes. Returns a new copy.
 *
 * @param  {Object|Array} obj object or array to use camelCaseKeys with
 * @return {Object|Array}     a copy of object or array, with camelcased keys
 */
function deepCamelCaseKeys(obj) {
  // If we're in an object, map the keys and pass the values through the same func
  if (_.isPlainObject(obj)) {
    obj = camelCaseKeys(obj);
    return _.mapValues(obj, deepCamelCaseKeys);
  }
  // If it's an array, iterate through it's values, and preserve its type.
  if (_.isArray(obj)) return _.map(obj, deepCamelCaseKeys);

  // If it's a primitive, return as is, reached end of the line.
  return obj;
}

const requestInstance = request.defaults({
  method: "GET",
  timeout: 23000,
  headers: {
    "User-Agent": `UA-Ripley-${
      process.env.COUNTRY === "chile" ? "CL" : "PE"
    }-Navegacion-Simple-v42.0-Commerce`,
  },
  json: true,
  simple: false,
  resolveWithFullResponse: true,
  /**
   * COMMERCE_ENV=preprod uses insecure HTTPS, so we need to set this flag to false. Otherwise
   * the request is rejected by the library
   */
  // rejectUnauthorized: !['preprod', 'qa'].includes(nconf.get('COMMERCE_ENV')),
});

function parseResponse(body, path, url = null) {
  let pathData = body;

  if (path) {
    pathData = _.get(body, path);
  }

  try {
    /**
     * [WS REST HOTFIX]
     * changes were made to the rest service endpoints where
     * a search (identified by attr recordSetTotal)
     * will always return even if no products are attached to it
     * but it will also return without a CatalogentryView attribute
     * this breaks a lot of things as you can't interate over it
     * so we just set a default here to prevent errors
     */
    if (pathData.recordSetTotal && !pathData.CatalogEntryView) {
      pathData.CatalogEntryView = [];
    }
  } catch (e) {
    throw e;
  }

  return pathData;
}
const ApiMarketplace = {
  getOffer: async (offerId) => {
    const url = `/api/offers/${offerId}?offer_state_codes=11`;
    const res = await requestInstance({
      url: `${MIRAKL__API}${url}`,
      headers: { Authorization: MIRAKL__AUTH_HEADER },
    });
    return parseResponse(res.body);
  },
  findShop: async (url) => {
    const res = await requestInstance({
      url: `${MIRAKL__API}${url}`,
      headers: { Authorization: MIRAKL__AUTH_HEADER },
    });
    return res;
  },
};
const addLocalShopAttributes = (shop) => {
  return {
    ...shop,
    localUrl: `/tienda/${slug(shop.shopName.toLowerCase())}-${shop.shopId}`,
  };
};

class _Marketplace {
  constructor() {
    this.map = {
      getOffer: (offerId) => `/api/offers/${offerId}?offer_state_codes=11`,
      shopEvaluations: (shopId) => `/api/shops/${shopId}/evaluations`,
      shop: (shopId) => `/api/shops?shop_ids=${shopId}`,
    };
  }

  getOffer = (offerId) => {
    return ApiMarketplace.getOffer(offerId)
      .catch((err) => {
        //
        console.error(err);
      })
      .then((offer) => {
        if (!offer.active) throw new Error("Offer not active");
        return offer;
      })
      .then(deepCamelCaseKeys)
      .then(addLocalShopAttributes);
  };

  async findShop(shopId) {
    const res = await ApiMarketplace.findShop(`${this.map.shop(shopId)}`);
    const shops = parseResponse(res.body, "shops");

    if (!shops.length) {
      throw new Error(`Marketplace request failed, shop not found: ${shopId}`);
    }

    return shops[0];
  }
}
const Marketplace = new _Marketplace();

const defaultRoute = process.env.MDCO__DEFAULT_URL;

async function getMarketplaceInformation(product) {
  if (!product.isMarketplaceProduct) return product;
  let availableSKUs = product.SKUs
    ? product.SKUs.filter((p) => !p.ineligible)
    : undefined;

  try {
    if (!product.SKUs.length && (!availableSKUs || availableSKUs.lenght)) {
      // writeToFile(getOutOfStockMessage(product.partNumber), reportName);
      throw new Error(`fuera de stock`);
    }
    // define this lately
    let offer;

    if (availableSKUs) {
      // Iterate through all children SKUs, obtaining each offer.
      const availableChildrenSKUs = await Promise.map(
        availableSKUs,
        (child) =>
          Marketplace.getOffer(child.partNumber)
            .then((childOffer) => {
              /* We only need one offer so we save the
               * first one that's returned for a child. */
              if (!offer) offer = childOffer;
              return childOffer.offerId;
            })
            .catch((err) => undefined) // Returns undefined to compact later.
      ).then((results) => _.compact(results));

      // Filter to get offers that are available on mirakl.
      availableSKUs = _.filter(availableSKUs, (child) =>
        availableChildrenSKUs.includes(parseInt(child.partNumber, 10))
      );

      // If no SKUs are available, then report as out of stock.
      if (!availableSKUs.length) {
        // writeToFile(getOutOfStockMessage(product.partNumber), reportName);
        throw new Error("fuera de stock");
      }
    }

    if (product.shortDescription) {
      product.seo.metaDescription = `${offer.shopName} - ${product.shortDescription}`;
    } else {
      const { description: shopDescription } = await Marketplace.findShop(
        offer.shopId
      );

      product.seo.metaDescription = `${offer.shopName} - ${shopDescription}`;
    }

    product.seo.metaDescription = _.truncate(product.seo.metaDescription, {
      length: 150,
      omission: "...",
    });
    return { ...product, marketplace: offer };
  } catch (err) {
    const { message } = err;
    console.log("***message:", message);
    if (message === "fuera de stock") {
      return product;
    }

    // if (err instanceof InvalidOfferId) {
    //   product.locals.unavailableList.marketplaceInvalidOffer = true;
    //   return product;
    // }

    // // if (err instanceof InactiveOffer) {
    // //   if (nconf.get('NODE_ENV') === 'development') throw err;
    // //   return product;
    // // }

    // if (err instanceof OutOfStock || err instanceof NotFound) {
    //   product.locals.outOfStockList.marketplace = true;
    //   return product;
    // }

    throw err;
  }
}
function _getShippingMethods(product) {
  if (!product.shippingmethods) {
    return {
      dDomicilio: false,
      rTienda: false,
      rCercano: false,
      cashOnDelivery: false,
    };
  }
  const methods = product.shippingmethods;

  const definedMethods = {
    dDomicilio: "DESP_DOMICILIO",
    rTienda: "RET_TIENDA",
    rCercano: "RET_CERCANO",
    cashOnDelivery: "PAGO_CONTRA_ENTREGA",
  };

  const retCercano = methods.find((method) => method === "RETIRO_CITY_BOX");

  if (retCercano) definedMethods.rCercano = "RETIRO_CITY_BOX";

  return Object.keys(definedMethods).reduce((acc, key) => {
    const IMSShippingKey = definedMethods[key];
    acc[key] = methods.includes(IMSShippingKey);
    return acc;
  }, {});
}

function _normalizeAttributes(product) {
  const _related = product.related
    .map((child) => child.attributes)
    .reduce((prev, current) => prev.concat(current));
  const groupedAttr = _.groupBy(_related, "identifier");

  return Object.keys(groupedAttr).map((defAttr) => ({
    displayable: groupedAttr[defAttr][0].displayable,
    searchable: "STRING",
    comparable: "true",
    identifier: groupedAttr[defAttr][0].identifier,
    name: groupedAttr[defAttr][0].name,
    usage: groupedAttr[defAttr][0].usage,
    Values: _.uniqBy(
      groupedAttr[defAttr].map((attr) => ({
        values: attr.Values[0].values,
        identifier: attr.identifier,
      })),
      (child) => child.values
    ),
  }));
}

const getRipleyPuntos = (price, productAttrs) => {
  if (!price || isNaN(_.toNumber(price))) return false;

  const productAttr = productAttrs
    ? productAttrs.find((elem) => elem.identifier === "tipo_producto_credito")
    : null;

  if (productAttr) {
    const ripleyPointsConversionRateSav = 1000;
    const ripleyPoints = Math.ceil(price / ripleyPointsConversionRateSav);
    return ripleyPoints;
  }

  let ripleyPointsConversionRate = 125;

  // if (checkCountry('peru')) {
  //   ripleyPointsConversionRate = 1.25;
  //   const ripleyPoints = Math.floor(price / ripleyPointsConversionRate);
  //   return ripleyPoints;
  // };

  const ripleyPoints = Math.ceil(price / ripleyPointsConversionRate);
  return ripleyPoints;
};
// maybe I have to log the product with no publish status
function _checkSKUs(SKUs) {
  const removedSKUs = [];
  const validatedSKUs = [];

  SKUs.forEach((sku) => {
    const { is_published, is_enabled, partNumber } = sku;
    if (sku.ineligible) {
      removedSKUs.push({ ...sku, statusVariation: "" });
    } else if (is_published && !is_enabled) {
      removedSKUs.push({
        partNumber,
        statusVariation: "Variation published but isn't enabled",
      });
    } else if (is_published && is_enabled) {
      validatedSKUs.push({ ...sku });
    } else if (!is_published && is_enabled) {
      const cpSku = {
        ...sku,
        ineligible: true,
        statusVariation: "Variation enabled but isn't published",
      };
      validatedSKUs.push(cpSku);
    } else if (!is_published && !is_enabled) {
      const cpSku = {
        ...sku,
        ineligible: true,
        statusVariation: "Variation isn't published and isn't enabled",
      };
      validatedSKUs.push(cpSku);
    }
  });

  return {
    removedSKUs,
    validatedSKUs,
  };
}

function _normalizePrices(prices, productAttrs) {
  let normalizedPrices = {};

  const pricesMap = {
    master: "ListPrice",
    sale: "OfferPrice",
    ripley: "CardPrice",
    discount: "Discount",
  };

  _.forEach(prices, (price, key) => {
    if (price && price.value) {
      key = pricesMap[key];
      normalizedPrices = {
        ...normalizedPrices,
        [`formatted${key}`]: i18n.formatCurrency(_.toNumber(price.value)),
        [key.charAt(0).toLowerCase() + key.slice(1)]: _.toNumber(price.value),
      };
    }
  });

  if (prices && prices.discount && prices.discount.percentage) {
    normalizedPrices.discountPercentage = _.toNumber(
      prices.discount.percentage
    );
  }

  const { cardPrice, listPrice, offerPrice } = normalizedPrices;

  const minPrice = cardPrice || offerPrice || listPrice;

  normalizedPrices.ripleyPuntos = getRipleyPuntos(minPrice, productAttrs);

  return normalizedPrices;
}

function _normalizeChildren(product) {
  const productAttrs = product.Attributes
    ? product.Attributes
    : product.related[0].attributes;

  const related = product.related.map((child) => ({
    sku_mkp: child.sku_mkp,
    partNumber: child.sku,
    stock: child.stock,
    ineligible: !child.stock,
    is_published: child.is_published,
    is_enabled: child.is_enabled,
    // orchestrator miss property...
    Attributes: child.attributes.map((e) => {
      return {
        ...e,
        Values: e.Values.map((val) => ({
          ...val,
          identifier: val.values,
        })),
      };
    }),
    SKUUniqueID: child.SKUUniqueID,
    xCatEntryQuantity: child.stock ? 1 : 0,
    images: child.images ? child.images.map((image) => image.src) : [],
    prices: _normalizePrices(child.price, productAttrs),
    shipping: _getShippingMethods(child),
    isMarketplaceProduct: false,
  }));

  // if (Image.isActive()) {
  //   related.forEach((child) => {
  //     // here missing
  //     if (ProductUtils.isMarketplaceProduct(child)) {
  //       child.images = child.images.map((e) =>
  //         Image.url(e, 'productFull', 'https').replace(/^https?:/, '')
  //       );
  //     }
  //   });
  // }

  return related;
}

const _normalizeImages = (product) => product.images.map(({ src }) => src);

function _getColors(product) {
  // REMOVE DUPLICATED VALUES BY NAME OF COLOR
  // THEN MAP TO GENERATE DATA STRUCTURE THAT WORKS WITH COLOR COMPONENT
  // FINALLY, REMOVE NOT COMPLETED COLORSs
  return _.uniqBy(product.colors, "name")
    .map((color) => ({
      uniqueID: color.sku_uid,
      hex: color.hex,
      slug: slug(color.name, { lower: true }),
      name: color.name,
      sku: color.sku,
    }))
    .filter((element) => {
      // BETTER WAY TO REMOVE UNDEFINEDS FROM OBJECTS?
      element = JSON.parse(JSON.stringify(element));
      if (Object.keys(element).length === 5) {
        return true;
      }
      return false;
    });
}

async function normalizeProduct(product) {
  const isUnique = product.related.filter(({ stock }) => stock).length === 1;
  const uniqueProduct = product.related.find(({ stock }) => stock) || {
    price: {},
  };

  let normalizedProduct = {};
  // add backend blacklist flag to a new variable
  const { blacklist: orchestratorBlacklist = false } = product;

  const { parentProductID, parentCategoryId } = product;
  const productAttrs = product.Attributes
    ? product.Attributes
    : product.related[0].attributes;

  normalizedProduct.productType = product.productType.trim();

  if (normalizedProduct.productType === "ItemBean") {
    normalizedProduct.productType = "ProductBean";
  }

  // not comming from orchestrator, default true
  normalizedProduct.buyable = product.buyable || true;

  normalizedProduct.prices = !isUnique
    ? _normalizePrices(product.parentpricestock.price, productAttrs)
    : _normalizePrices(uniqueProduct.price, productAttrs);

  normalizedProduct.Attributes = _normalizeAttributes(product);

  normalizedProduct.productString = slug(
    `${product.name} ${product.partNumber}`,
    {
      lower: true,
    }
  );

  if (normalizedProduct.productType !== "PackageBean") {
    normalizedProduct.SKUs = _normalizeChildren(product);
    normalizedProduct.numberOfSKUs = normalizedProduct.SKUs.length;

    if (normalizedProduct.numberOfSKUs === 1) {
      normalizedProduct.singleSKUUniqueID = product.uniqueID;
      // missing SKUUniqueID from unique child product
      normalizedProduct.SKUs[0].SKUUniqueID = product.uniqueID;
    }
  }

  const _selectedPartNumber = product.partNumber;

  normalizedProduct.partNumber = product.parentProductID;

  normalizedProduct.name = product.name.toUpperCase();

  normalizedProduct.longDescription = product.longDescription;

  normalizedProduct.title = product.title;

  normalizedProduct.metaDescription = product.metaDescription;

  normalizedProduct.MerchandisingAssociations =
    product.MerchandisingAssociations;

  normalizedProduct.uniqueID = product.uniqueID;

  normalizedProduct.shortDescription = product.shortDescription;

  normalizedProduct.fullImage = product.fullImage;

  normalizedProduct.manufacturer = product.manufacturer;

  // make components object
  if (normalizedProduct.productType === "PackageBean") {
    normalizedProduct._Components = await Promise.all(
      product.components.map((component) => bySku(component.sku))
    );
    normalizedProduct.Components = normalizedProduct._Components.map(
      (e) => e.product
    );
  }

  normalizedProduct = utils.processProduct(normalizedProduct);

  normalizedProduct.xCatEntryCategory = product.xcatentry_category || "";

  normalizedProduct.shippingmethods = product.parentpricestock.shippingmethods;

  normalizedProduct.is_published = product.is_published;

  normalizedProduct.shipping = _getShippingMethods(normalizedProduct);

  if (!normalizedProduct.single) {
    normalizedProduct.colors = _getColors(product);
  }

  normalizedProduct.images = _normalizeImages(product);

  // Product and Item Bean Images
  // Component product - PackageBean Images
  if (normalizedProduct.productType === "PackageBean") {
    normalizedProduct.images = _.concat(
      normalizedProduct.images,
      ...normalizedProduct.components.map((e) => e.images)
    );
  }

  // normalize most product data
  normalizedProduct.warranties = normalizedProduct.warranties
    ? normalizedProduct.warranties
    : [];
  normalizedProduct.accessories = normalizedProduct.accessories
    ? normalizedProduct.accessories
    : [];
  normalizedProduct.recycling = normalizedProduct.recycling
    ? normalizedProduct.recycling
    : [];

  normalizedProduct.parentProductID = parentProductID;
  // parse warranties prices
  normalizedProduct.warranties = normalizedProduct.warranties.map(
    (warranty) => {
      const { Price } = warranty;

      warranty.Price = [
        {
          formattedPriceValue: Price.master.value
            ? i18n.formatCurrency(Price.master.value)
            : null,
          priceUsage: "List",
          priceValue: Price.master.value
            ? i18n.formatCurrency(Price.master.value)
            : null,
        },
        {
          formattedPriceValue: Price.sale.value
            ? i18n.formatCurrency(Price.sale.value)
            : null,
          priceUsage: "Offer",
          priceValue: Price.sale.value
            ? i18n.formatCurrency(Price.sale.value)
            : null,
        },
      ];

      return warranty;
    }
  );

  normalizedProduct.accessories = normalizedProduct.accessories.map(
    (accesory) => {
      accesory.Price = [
        {
          formattedPriceValue: i18n.formatCurrency(accesory.Price.sale.value),
          priceUsage: "Offer",
          priceValue: accesory.Price.sale.value,
        },
      ];
      return accesory;
    }
  );

  normalizedProduct.recycling = normalizedProduct.recycling.map((el) => {
    let priceRipley = {};
    if (el.Price) {
      if (el.Price.ripley) {
        priceRipley = el.Price.ripley;
      }
    }
    el.Price = [
      {
        formattedPriceValue: el.Price.master.value
          ? i18n.formatCurrency(el.Price.master.value)
          : null,
        priceUsage: "List",
        priceValue: el.Price.master.value
          ? i18n.formatCurrency(el.Price.master.value)
          : null,
      },
      {
        formattedPriceValue: priceRipley.value
          ? i18n.formatCurrency(priceRipley.value)
          : null,
        priceUsage: "Offer",
        priceValue: priceRipley.value
          ? i18n.formatCurrency(priceRipley.value)
          : null,
      },
    ];

    return el;
  });

  // for barilliance and power reviews ID
  normalizedProduct.partNumber = normalizedProduct.partNumber.toUpperCase();

  // to cuca temporary use
  normalizedProduct.selectedPartNumber = _selectedPartNumber;

  normalizedProduct.parentCategoryId = parentCategoryId;

  // propagate orchestrator blacklist to next layers
  normalizedProduct.orchestratorBlacklist = orchestratorBlacklist;
  normalizedProduct.breadcrumbs = product.breadcrumbs || [];
  // add flag to empty prices array, temporary solution
  if (_.every(normalizedProduct.prices, (e) => e === false)) {
    normalizedProduct.locals.unavailableList.noPricesFromContent = true;
  }

  if (normalizedProduct.is_published && normalizedProduct.SKUs) {
    const { removedSKUs, validatedSKUs } = _checkSKUs(normalizedProduct.SKUs);
    normalizedProduct.removedSKUs = removedSKUs;
    normalizedProduct.SKUs = validatedSKUs;
  }

  // TODO: Now it's beta features, maybe in the future itsn't.

  const showFantasyColors = normalizedProduct.definingAttributes.length;

  if (showFantasyColors) {
    const { definingAttributes } = normalizedProduct;

    definingAttributes.forEach((attribute) => {
      if (attribute.identifier === "color_fantasia") {
        attribute.name = "Color";
        return attribute;
      }

      return attribute;
    });
  }

  // add flag to empty prices array, temporary solution
  if (_.every(normalizedProduct.prices, (e) => e === false)) {
    // LoggerLevel()
  }

  return normalizedProduct;
}

const bySku = async (partNumber) => {
  const path = `products/by-sku/${partNumber}`;
  const URL = `${defaultRoute}${path}`;

  try {
    if (!utils.validPartNumber(partNumber)) {
      writeToFile(`[No es un sku valido: ${partNumber}]`, reportName);
      throw new Error("is not a valid sku");
    }
    const { data } = await axios.get(URL);
    if (!data) {
      // some error
      writeToFile(
        `[Producto: ${partNumber} sin contenido no se puede mostrar en navegación]`,
        reportName
      );
      return null;
    }

    let normalizedProduct = await normalizeProduct(data);
    normalizedProduct = await getMarketplaceInformation(normalizedProduct);
    return { product: normalizedProduct };
  } catch (err) {
    console.error(err);
    throw err;
    // do something
  }
};
const handlers = {
  "get@by-sku": async (req, res, next) => {
    let partNumber = req.params.partNumber;
    // console.log(`calling get by sku: ${partNumber}`);
    try {
      const data = await bySku(partNumber);
      if (data) {
        const { product } = data;
        if (product.isOutOfStock && product.is_published) {
          writeToFile(
            `[Producto: ${partNumber} se encuentra publicado y sin stock en navegación]`,
            reportName
          );
        } else if (product.isUnavailable && product.is_published) {
          writeToFile(
            `[Producto: ${partNumber} se encuentra publicado y pronto disponible en navegacion]`,
            reportName
          );
        } else if (!product.is_published && !product.isOutOfStock) {
          writeToFile(
            `[Producto: ${partNumber} no se esta publicado y tiene stock en navegación]`,
            reportName
          );
        } else if (product.isOutOfStock && !product.is_published) {
          writeToFile(
            `[Producto: ${partNumber} no se encuentra publicado y no tiene stock en navegación]`,
            reportName
          );
        } else {
          writeToFile(
            `[Producto: ${partNumber} se encuentra publicado y con stock en navegación]`,
            reportName
          );
        }

        return res.json({
          data,
          message: "success",
          status: 200,
        });
      }

      return res.json({
        status: 204,
        message: "no content",
      });
    } catch (err) {
      // do something
      console.log(`error on ${partNumber}`);
      return res.send({
        error: true,
        message: err.message || "error inesperado",
        status: err.code || 500,
      });
    }
  },
};

module.exports = handlers;
