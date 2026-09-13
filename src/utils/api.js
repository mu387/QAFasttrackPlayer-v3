const axios = require('axios');
const axiosRetry = require('axios-retry');
console.log("ENV BASE URL =>", process.env.REACT_APP_API_BASE_URL);

class Api {
  constructor() {
    console.log('first');
    this.apiUrl = process.env['REACT_APP_API_BASE_URL'];    
    let service = axios.create({
      headers: {
        csrf: 'token',
        accept: 'application/json',
      },
    });
    const retryDelay = (retryNumber = 0) => {
      const seconds = Math.pow(2, retryNumber) * 1000;
      const randomMs = 1000 * Math.random();
      return seconds + randomMs;
    };

    axiosRetry(service, {
      retries: 2,
      retryDelay,
      // retry on Network Error & 5xx responses
      retryCondition: axiosRetry.isRetryableError,
    });

    service.interceptors.response.use(this._handleSuccess, this._handleError);
    this.service = service;
  }

  _handleSuccess(response) {
    return response;
  }

  _handleError = error => {
    switch (error.response && error.response.status) {
      case 401:
        console.error('Unauthorized, check console for details');
        break;
      case 404:
        console.error('Route not found, check console for details');
        break;
      default:
        console.log(error);
        //toast.error('Server/Unknown error occurred, check console for details');
        break;
    }

    return Promise.reject(error);
  };

  _redirectTo = (document, path) => {
    document.location = path;
  };

  /**
   * Method to handle api requests.
   * @param {string} type
   * @param {string} path
   * @param {Object} [payload]
   */
  request(config) {
    // request(type, path, payload, bearerToken) {
    config.method = config.method.toLowerCase();

    if (config.url.includes('http') || config.url.includes('https')) {
      if (config.url.startsWith('/'))
        config.url = config.url.substr(config.url.indexOf('/') + 1);
    } else {
      if (!config.baseURL) {
        config.url = this.apiUrl + config.url;
      }
    }
    this.service.defaults.headers.Authorization = `Bearer ${config?.token || ''}`;
    //Load token from local storage if not available in request
    // if (typeof config?.headers?.Authorization === 'undefined') {
    //     let currentUser = secureLocalStorage.getItem('currentUser');
    //     if (typeof currentUser !== 'undefined' && currentUser) {
    //         const bearerToken = currentUser.token;
    //         this.service.defaults.headers.Authorization = `Bearer ${bearerToken}`;
    //     }
    // }

    // if (config.method === 'get') {
    //     return this.service.get(path).then((response) => response.data);
    // }

    return this.service.request({ ...config }).then(response => response.data);
  }
}
const api = new Api();
module.exports = { api };
