const slug = require("slug");
const Image = require("../shared-modules/imgix-images");
const _ = require("lodash");
const Config = {
  IMG_PATH: "//home.ripley.cl/store",
  base: "www.ripley.cl",
};

const preferredAttributesOrder = ["color", "...rest", "Seller"];

function sortByArray(
  target,
  targetOrder,
  targetField = null,
  keepOriginalOrder = false
) {
  let endIndex = targetOrder.indexOf("...rest");
  if (endIndex < 0) endIndex = Infinity;

  const sortIterators = [
    (item) => {
      const currentItem = targetField ? item[targetField] : item;
      const foundIndex = targetOrder.indexOf(currentItem);

      if (foundIndex < 0) {
        return endIndex;
      }

      if (foundIndex > endIndex) {
        return endIndex + foundIndex;
      }

      return foundIndex;
    },
  ];
  // Automatically sort alphabetically afterwards, unless keepOriginalOrder is set to TRUE
  if (!keepOriginalOrder) sortIterators.push(targetField || _.identity);

  return _.sortBy(target, sortIterators);
}

const ProductUtils = {
  parsePriceRange(priceRange) {
    if (_.includes(priceRange, "-")) {
      const parsedRange = priceRange
        .split("-")
        .map((rate) => parseInt(rate.trim(), 10));

      const rangeIsValid = !_.some(parsedRange, (rate) => isNaN(rate));

      return rangeIsValid
        ? _.zipObject(["priceRangeMin", "priceRangeMax"], parsedRange)
        : false;
    }

    return false;
  },
  isEANProduct(product) {
    if (!product.SKUs || !product.SKUs.length) return false;

    return product.SKUs.some((sku) =>
      _.get(sku, "Attributes", []).some((attr) => attr.identifier === "Seller")
    );
  },
  addCDNImagePath(url) {
    if (!url) return "";

    url = url.replace("/wcsstore/", "");
    if (Config.IMG_PATH) {
      const urlPath = url.match(/(Attachment.*)/);
      if (urlPath && urlPath.length) {
        return `${Config.IMG_PATH}/${urlPath[0]}`;
      }
    }

    return `//${Config.base}/wcsstore/${url}`;
  },
  processProductImages(product, opts = {}) {
    const _images = [];

    // Start with the 'cover' image
    if (product.fullImage) _images.push(product.fullImage);

    // Add normal image sources
    if (product.Attachments) {
      _images.push(
        ...product.Attachments.filter((a) => a.usage === "IMAGES").map(
          (a) => a.path
        )
      );
    }

    // Adds images from descriptive attributes that match the pattern (usually marketplace products)
    _.reduce(
      product.Attributes,
      (accumulator, attr) => {
        if (attr.usage === "Descriptive" && /^Imagen[0-9]+$/i.test(attr.name)) {
          const value = _.get(attr, "Values.0.values");
          if (value) accumulator.push(value);
        }

        return accumulator;
      },
      _images
    );

    // At this point we have all the images within _images
    const { images, thumbnails } = _images.reduce(
      (accumulator, imgUrl) => {
        // Dont add hostname to url if it's a marketplace product.
        if (!opts.isMarketplaceProduct) {
          imgUrl = ProductUtils.addCDNImagePath(imgUrl);
        }

        if (Image.isActive() && opts.isMarketplaceProduct) {
          // Apply Imgix's transforms on both thumbnail and full image
          accumulator.thumbnails.push(
            Image.url(imgUrl, "productThumbnail", "https").replace(
              /^https?:/,
              ""
            )
          );
          accumulator.images.push(
            Image.url(imgUrl, "productFull", "https").replace(/^https?:/, "")
          );
        } else {
          // Do not transform in PE. Both thumbnails and images will be the same
          accumulator.thumbnails.push(imgUrl);
          accumulator.images.push(imgUrl);
        }
        return accumulator;
      },
      {
        thumbnails: [],
        images: [],
      }
    );

    const result = {
      fullImage: images[0],
      thumbnail: thumbnails[0],
      images,
      thumbnails,
    };

    return result;
  },

  isMarketplaceProduct(product) {
    if (
      product.partNumber &&
      ProductUtils.isMarketplacePartNumber(product.partNumber)
    ) {
      return true;
    }

    const attributes = product.attributes || product.Attributes;
    if (!attributes) return false;

    return _.some(attributes, (attr) => {
      if (!attr || !attr.identifier) return false;
      return attr.identifier === "IsMiraklProduct";
    });
  },

  isMarketplacePartNumber(partNumber) {
    if (/^\d{4,6}$/.test(partNumber)) {
      return true;
    }

    return _.some(["mpm", "pmp"], (prefix) =>
      _.startsWith(partNumber.toLowerCase(), prefix)
    );
  },

  setupGetters(product) {
    if (!product) return product;

    // Set up the locals if they weren't defined before
    if (!product.locals) {
      product.locals = {
        outOfStockList: {},
        unavailableList: {},
      };
    }

    // Wrap this in a try, as if the getters were previously defined, this will throw a TypeError
    try {
      Object.defineProperty(product, "isUnavailable", {
        enumerable: true,
        get() {
          return _.some(this.locals.unavailableList);
        },
      });

      Object.defineProperty(product, "isOutOfStock", {
        enumerable: true,
        get() {
          // isUnavailable has precedence over isOutOfStock, in case both are defined.
          if (this.isUnavailable) return false;
          return _.some(this.locals.outOfStockList);
        },
      });
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }

    return product;
  },

  getNormalizedMerchandisingAssociations(merchandisingAssociations) {
    if (!merchandisingAssociations) return {};
    return {
      accessories: merchandisingAssociations.filter(
        (a) => a.type === "ACCESSORY" && !!a.name
      ),
      warranties: merchandisingAssociations.filter(
        (a) => a.type === "EXTRAGARANTIA" && !!a.name
      ),
      recycling: merchandisingAssociations.filter(
        (a) => a.type === "X-SELL" && !!a.name
      ),
    };
  },
};

module.exports.validPartNumber = (partNumber) =>
  /^\d{4,9}$/.test(partNumber) || // Marketplace children part numbers are 4 to 6 digits long
  /^(mpm|mpp|pmp|sk\-)?([\d\-?!\s]){10,20}(p)?$/i.test(partNumber);

module.exports.processProduct = (product, opts = {}) => {
  // If the product returned an error, return as is, don't try to process.
  if (product._error) return product;
  const _product = ProductUtils.setupGetters({});

  Object.assign(
    _product,
    ProductUtils.getNormalizedMerchandisingAssociations(
      product.MerchandisingAssociations
    )
  );

  // Product SEO information
  _product.seo = {
    title: product.title && product.title.replace(/\[.+\]\s?/, ""),
    metaDescription:
      product.metaDescription &&
      product.metaDescription.replace(/\[.+\]\s?/, ""),
    metaKeyword: product.metaKeyword,
  };

  // product identification
  _product.partNumber = product.partNumber;

  // product description
  _product.name = product.name && product.name.replace(/\[.+\]\s?/, "");
  _product.productString = slug(`${_product.name} ${product.partNumber}`, {
    lower: true,
  });
  const urlFor = (key, hash) => {
    let link = "";
    if (hash && hash.model && hash.model.productString) {
      link += hash.model.productString;
    } else if (hash.productString) {
      link += hash.productString;
    } else {
      link += "";
    }
    return link;
  };
  _product.url = "https://simple.ripley.cl" + urlFor("product", _product);
  _product.productType = product.productType;

  /**
   * Attempt to pass long description through cheerio, as this will automatically any
   * misclosed tags, so we can more safely mount these later. If this fails, it will just use
   * the value 'as is'.
   */

  _product.longDescription = product.longDescription;

  _product.marketplace = {};
  _product.shortDescription = product.shortDescription;
  _product.manufacturer = product.manufacturer;
  _product.buyable = product.buyable === "true" || product.buyable;

  if (_product.buyable === false) {
    _product.locals.outOfStockList.buyable = true;
  }

  // product attributes and shipping
  _product.shipping = {};
  _product.shipping.rTienda = false;
  _product.shipping.dDomicilio = false;
  _product.shipping.rCercano = false;
  _product.shipping.cashOnDelivery = false;

  _product.definingAttributes = [];
  _product.attributes = [];

  _product.isMarketplaceProduct = false;

  if (ProductUtils.isMarketplaceProduct(product)) {
    _product.isMarketplaceProduct = true;
    _product.shipping.dDomicilio = true;
    _product.sellerId = "";

    if (product.Attributes) {
      product.Attributes.forEach((attr) => {
        if (attr.identifier === "SellerID")
          _product.sellerId = attr.Values[0].values;
      });
    }
  }

  Object.assign(
    _product,
    ProductUtils.processProductImages(product, {
      isMarketplaceProduct: _product.isMarketplaceProduct,
    })
  );

  if (product.Attributes) {
    const attributes = product.Attributes.map((attr) => {
      const attribute = {
        displayable: attr.displayable !== "false" && attr.displayable !== false,
        id: attr.uniqueID,
        identifier: attr.identifier,
        name: attr.name,
        usage: attr.usage.toLowerCase(),
      };

      if (attribute.usage === "defining") attribute.values = attr.Values;
      if (attribute.usage === "descriptive" && attr.Values) {
        attribute.value = attr.Values[0].values;
      }

      return attribute;
    });

    /*
     * Defining Attributes are Colors, Sizes, etc, they're used
     * to "create" children SKUs defined later
     * Descriptive attributes, we have no idea, but contain Shipping information
     * among other things
     */
    const groupedAttrs = _.groupBy(attributes, "usage");

    _product.attributes = groupedAttrs.descriptive || [];

    _product.definingAttributes = sortByArray(
      groupedAttrs.defining || [],
      preferredAttributesOrder,
      "identifier"
    );

    if (_product.manufacturer) {
      const manufacturer = {
        displayable: true,
        name: "Marca",
        usage: "descriptive",
        value: _product.manufacturer,
      };

      _product.attributes.unshift(manufacturer);
    }

    // We should do this the other way around, specify keys to display
    const attributesKeysToHide = [
      "IsMiraklProduct",
      "RETIRO EN TIENDA",
      "DESPACHO A DOMICILIO",
      "Retiro Cercano",
      "PAGO CONTRA ENTREGA",
      "OFFER_STATE",
      "Seller",
      "SellerID",
      "imgIcon_GEN_ATTR_SOLOCAR",
      "RETIRO REMOTO",
      "Foto Principal",
    ];

    _product.attributes.forEach((attr, key) => {
      if (attr.name === "RETIRO EN TIENDA") _product.shipping.rTienda = true;
      if (attr.name === "DESPACHO A DOMICILIO") {
        _product.shipping.dDomicilio = true;
      }
      if (attr.name === "Retiro Cercano") _product.shipping.rCercano = true;
      if (attr.name === "RETIRO REMOTO") _product.shipping.rCercano = true;
      if (attr.name === "PAGO CONTRA ENTREGA") {
        _product.shipping.cashOnDelivery = true;
      }
    });

    _product.attributes = _.filter(
      _product.attributes,
      (attr) => !attributesKeysToHide.includes(attr.name)
    );

    _product.definingAttributes = _.filter(
      _product.definingAttributes,
      (attr) => !attributesKeysToHide.includes(attr.name)
    ).map((attr) => {
      // Temporary fix to account for some attributes that do not hold any values.
      // This is incorrect on the client's end, as this means a product won't have any
      // options on a particular attribute.
      if (!Array.isArray(attr.values)) {
        attr.values = [];
        return attr;
      }

      // Adds a slug prop to every value on every attribute.

      attr.values = attr.values.map((v) => {
        if (_.isPlainObject(v)) {
          v.slug = slug(v.values, {
            lower: true,
          });
        }
        return v;
      });

      // If attr has "talla" identifier, we send them sorted
      // if (attr.identifier.includes("talla")) {
      //   const sortedValues = ProductUtils.sortSizes(attr.values);
      //   attr.values = sortedValues;
      // }

      return attr;
    });

    // if we dont have dDomicilio, there cannot be rCercano even if the attribute says so
    if (!_product.shipping.dDomicilio) _product.shipping.rCercano = false;
  }

  // added for product view
  if (product.SKUs) {
    _product.SKUs = _.cloneDeep(product.SKUs);

    // Normalize xCatEntryQuantity for every children SKU.
    // If its value is 0, filter it out to make it unavailable.

    _product.SKUs = _product.SKUs.map((subProduct) => {
      // Temporary, until peru gets compliancy with chile.
      subProduct.xcatentry_quantity =
        subProduct.xcatentry_quantity || subProduct.xcatentry_xquantity;

      if (subProduct.xcatentry_quantity) {
        subProduct.xCatEntryQuantity = ProductUtils.parseXCatEntryQuantity(
          subProduct.xcatentry_quantity
        );

        delete subProduct.xcatentry_quantity;
        delete subProduct.xcatentry_xquantity;
      }

      subProduct.ineligible = subProduct.xCatEntryQuantity === 0;

      subProduct.Attributes = subProduct.Attributes || [];

      return subProduct;
    });

    if (_product.SKUs.every((sp) => sp.ineligible)) {
      _product.locals.outOfStockList.childrenXCatEntryQtyZero = true;
    }
  }
  _product.isEANProduct = ProductUtils.isEANProduct(_product);

  // Temporary, until peru gets compliancy with chile.
  product.xcatentry_quantity =
    product.xcatentry_quantity || product.xcatentry_xquantity;

  if (product.xcatentry_quantity) {
    _product.xCatEntryQuantity = ProductUtils.parseXCatEntryQuantity(
      product.xcatentry_quantity
    );
  }

  if (_product.xCatEntryQuantity === 0) {
    _product.locals.outOfStockList.xCatEntryQuantity = true;
  }

  if (product.numberOfSKUs) {
    _product.numberOfSKUs = parseInt(product.numberOfSKUs, 10);
  }

  if (_product.numberOfSKUs === 0) {
    _product.locals.outOfStockList.numberOfSKUs = true;
  }

  if (product.parentCategoryID) {
    _product.parentCategoryID = product.parentCategoryID;
  }

  // product items
  if (_product.productType === "ItemBean") {
    _product.parentProductID = product.parentProductID;
  }

  if (product.xcatentry_category) {
    _product.xCatEntryCategory = product.xcatentry_category;
  }

  if (_product.productType === "ProductBean") {
    _product.single = false;

    if (
      // product.Attributes are present on the product view, not the search
      product.Attributes &&
      _product.numberOfSKUs > 1 &&
      _product.definingAttributes.length === 0
    ) {
      _product.single = false;
      _product.locals.unavailableList.noVariations = true;
    } else if (_product.definingAttributes.length === 0) {
      _product.single = true;
      _product.singleSKUUniqueID = product.singleSKUUniqueID;
    }
  } else if (_product.productType === "PackageBean") {
    _product.single = true;
    _product.singleSKUUniqueID = product.uniqueID;
    _product.components =
      product.Components && product.Components.map(ProductUtils.processProduct);
  }

  let priceRange = {};

  priceRange = ProductUtils.parsePriceRange(product.xcatentry_priceRange);

  _product.prices = {
    ...product.prices,
    ...priceRange,
  };

  return _product;
};
