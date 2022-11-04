const _ = require("lodash");
const request = require("request-promise");
const ImgixClient = require("imgix-core-js");
const Promise = require("bluebird");

const IMGIX__HOST = "ripleycl.imgix.net";
const SECURE_URL_TOKEN = "VWpyPqbkytgFcxFs";
const CLOUDFLARE_HOST = "imgix.ripley.cl";
const IMGIX__KEEP_ASPECT = true;

const API_KEY = "";

const ERRORS = {
  default: "Ocurrio un error con esta url, inténtalo de nuevo.",
  400: "Formato de url incorrecto.",
  410: "Estas urls no se han encontrado, revisa que esten correctas e intenta denuevo.",
};

let isConfigured = false;
let isDisabled = false;
let imgix = false;

if (IMGIX__HOST && SECURE_URL_TOKEN) {
  imgix = new ImgixClient({
    domain: IMGIX__HOST,
    secureURLToken: SECURE_URL_TOKEN,
  });

  isConfigured = true;
} else {
}

const aspectOptions = {
  fit: "fillmax",
};

if (IMGIX__KEEP_ASPECT === false) {
  delete aspectOptions.fit;
}

const stripWhitespace = {
  trimcolor: "FFFFFF",
  trim: "color",
};

const formats = {
  default: { auto: "compress,format" },
  productFull: {
    w: 750,
    h: 555,
    ch: "Width",
    auto: "format",
    cs: "strip",
    bg: "FFFFFF",
    q: 60,
    ...stripWhitespace,
    ...aspectOptions,
  },
  productThumbnail: {
    w: 270,
    h: 220,
    bg: "FFFFFF",
    ch: "Width,Save-Data",
    auto: "format,compress",
    ...stripWhitespace,
    ...aspectOptions,
  },
};
module.exports = {
  disable(current = true) {
    isDisabled = current;
  },

  isConfigured() {
    return isConfigured;
  },

  isDisabled() {
    return isDisabled;
  },

  isActive() {
    return this.isConfigured() && !this.isDisabled() && imgix;
  },

  rebuildIfTwoProtocols(url) {
    /**
     * imgix goes nuts when you pass in urls with two protocols (which are proxying too)
     * https://thumb.babytuto.com/unsafe/300x300/https://s3-us-west-2.amazonaws.com/babytuto/8b0c87c5f088576defef5348a71c708f.jpg
     * to fix this, we need to encode the last https bit twice
     * so we do some splitting to encode it once and then again when passing it to imgix
     */
    try {
      const urlsProtocols = url.match(/https?\:\/\//g);

      if (urlsProtocols.length > 1) {
        let [mainUrl, subUrl] = _.compact(url.split(urlsProtocols[1]));

        /**
         * if subUrl protocol matches mainUrl protocol, the string returns without one
         * if they differ (https vs http), it comes with one, so we make sure that its
         * present by just removing it in any case if it exists, and always adding it back
         */
        mainUrl = urlsProtocols[0] + mainUrl.replace(/https?\:\/\//, "");
        subUrl = encodeURIComponent(urlsProtocols[1] + subUrl);
        url = mainUrl + subUrl;
      }
    } catch (e) {}

    return url;
  },

  // Returns transformed url only
  url(url, format = "default", protocolIfMissing = "http") {
    // Validates that urls have either of the permitted protocols, or none at all.
    const urlValidator = /^((http|https):\/\/|(\/\/)).*/;

    // Return if falsey or invalid url
    if (!url || !urlValidator.test(url)) return url;

    // Returns original if should passthrough (disabled or not configured)
    if (!this.isActive()) return this._useOriginal(url);

    if (_.startsWith(url, "//")) {
      if (!["http", "https"].includes(protocolIfMissing)) {
        throw new Error(`Protocol ${protocolIfMissing} not supported.`);
      }

      url = `${protocolIfMissing}:${url}`;
    }

    url = this.rebuildIfTwoProtocols(url);

    return imgix.buildURL(url, this._parseOptions(format));
  },

  // Remove cache for a bunch (or just one) of imgix images.
  async purge(urls, user) {
    if (!urls) {
      return false;
    }

    const purgePromise = (url) =>
      this._purgeRequest(url)
        .then(() => ({
          url,
          code: 200,
        }))
        .catch((error) => ({
          url,
          code: error.statusCode,
        }));

    return Promise.map(urls.split("\n"), purgePromise, {
      concurrency: 10,
    }).then((purgedUrls) => {
      const groupedUrls = _.groupBy(purgedUrls, "code");

      const attachments = Object.keys(groupedUrls).map((code) => {
        if (code === "200") {
          const amount = groupedUrls[code].map(({ url }) => url).length;

          return {
            title: `${amount} urls borradas exitosamente.`,
            color: "good",
          };
        }

        return {
          title: ERRORS[code] || ERRORS.default,
          color: "danger",
          text: groupedUrls[code].map(({ url }) => url).join("\n"),
        };
      });

      attachments.push({
        author_name: user,
      });
    });
  },

  // Purge request url
  async _purgeRequest(url) {
    if (!url) return false;

    return request({
      uri: "https://api.imgix.com/v2/image/purger",
      method: "POST",
      auth: {
        username: API_KEY,
      },
      body: {
        url,
      },
      json: true,
    });
  },

  // Check whether it should attempt to pick an image format
  _parseOptions(optionsOrFormat) {
    if (typeof optionsOrFormat === "string") {
      return this._getImageFormat(optionsOrFormat);
    }

    return optionsOrFormat;
  },

  // Does something if we're using the original image
  _useOriginal(url) {
    if (!isConfigured) {
    }
    return url;
  },

  /**
   * Gets a particular format from the formats hash, extending the defaults
   * @param  {String} format the key of the format on the hash
   * @return {Object}        The image format object
   */
  _getImageFormat(format = "default") {
    if (!formats[format]) {
      format = "default";
    }

    return formats[format];
  },
};
