function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

import { ApolloClient } from 'apollo-client';
import { split, from } from 'apollo-link';
import { HttpLink } from 'apollo-link-http';
import { createUploadLink } from 'apollo-upload-client';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import MessageTypes from 'subscriptions-transport-ws/dist/message-types';
import { WebSocketLink } from 'apollo-link-ws';
import { getMainDefinition } from 'apollo-utilities';
import { createPersistedQueryLink } from 'apollo-link-persisted-queries';
import { setContext } from 'apollo-link-context';
import { withClientState } from 'apollo-link-state';
import { w3cwebsocket as W3CWebSocket } from 'websocket';
import * as AbsintheSocket from '@absinthe/socket';
import { createAbsintheSocketLink } from '@absinthe/socket-apollo-link';
import { Socket as PhoenixSocket } from 'phoenix'; // Create the apollo client

export function createApolloClient(_ref) {
  var httpEndpoint = _ref.httpEndpoint,
      _ref$wsEndpoint = _ref.wsEndpoint,
      wsEndpoint = _ref$wsEndpoint === void 0 ? true : _ref$wsEndpoint,
      _ref$uploadEndpoint = _ref.uploadEndpoint,
      uploadEndpoint = _ref$uploadEndpoint === void 0 ? null : _ref$uploadEndpoint,
      _ref$tokenName = _ref.tokenName,
      tokenName = _ref$tokenName === void 0 ? 'apollo-token' : _ref$tokenName,
      _ref$persisting = _ref.persisting,
      persisting = _ref$persisting === void 0 ? false : _ref$persisting,
      _ref$ssr = _ref.ssr,
      ssr = _ref$ssr === void 0 ? false : _ref$ssr,
      _ref$websocketsOnly = _ref.websocketsOnly,
      websocketsOnly = _ref$websocketsOnly === void 0 ? false : _ref$websocketsOnly,
      _ref$phoenix = _ref.phoenix,
      phoenix = _ref$phoenix === void 0 ? false : _ref$phoenix,
      _ref$link = _ref.link,
      link = _ref$link === void 0 ? null : _ref$link,
      _ref$cache = _ref.cache,
      cache = _ref$cache === void 0 ? null : _ref$cache,
      _ref$apollo = _ref.apollo,
      apollo = _ref$apollo === void 0 ? {} : _ref$apollo,
      _ref$clientState = _ref.clientState,
      clientState = _ref$clientState === void 0 ? null : _ref$clientState,
      _ref$getAuth = _ref.getAuth,
      getAuth = _ref$getAuth === void 0 ? defaultGetAuth : _ref$getAuth;
  var wsClient, authLink, stateLink;
  var disableHttp = websocketsOnly && !ssr && wsEndpoint;
  var options = {
    transport: process.server ? W3CWebSocket : null // Apollo cache

  };

  if (!cache) {
    cache = new InMemoryCache();
  }

  if (!disableHttp) {
    if (!link) {
      link = new HttpLink({
        // You should use an absolute URL here
        uri: httpEndpoint
      });
    } // HTTP Auth header injection


    authLink = setContext(function (_, _ref2) {
      var headers = _ref2.headers;
      return {
        headers: _objectSpread({}, headers, {
          authorization: getAuth(tokenName)
        })
      };
    }); // Concat all the http link parts

    link = authLink.concat(link);
  } // On the server, we don't want WebSockets and Upload links


  if (!ssr) {
    // If on the client, recover the injected state
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-underscore-dangle
      var state = window.__APOLLO_STATE__;

      if (state) {
        // If you have multiple clients, use `state.<client_id>`
        cache.restore(state.defaultClient);
      }
    }

    if (!disableHttp) {
      if (persisting) {
        link = createPersistedQueryLink().concat(link);
      } // File upload


      var uploadLink = authLink.concat(createUploadLink({
        uri: uploadEndpoint || httpEndpoint
      })); // using the ability to split links, you can send data to each link
      // depending on what kind of operation is being sent

      link = split(function (operation) {
        return operation.getContext().upload;
      }, uploadLink, link);
    } // Web socket


    if (wsEndpoint || phoenix) {
      var wsLink = null;

      if (phoenix) {
        var token = getAuth(tokenName).replace(/\s/g, '').split('Bearer');
        var tokenString = token[1].trim();
        options = Object.assign(options, {
          params: {
            token: tokenString
          }
        });
        wsLink = createAbsintheSocketLink(AbsintheSocket.create(new PhoenixSocket('wss://murmuring-peak-60537.herokuapp.com/socket', options)));
      } else {
        wsClient = new SubscriptionClient(wsEndpoint, {
          reconnect: true,
          connectionParams: function connectionParams() {
            return {
              authorization: getAuth(tokenName)
            };
          }
        }); // Create the subscription websocket link

        wsLink = new WebSocketLink(wsClient);
      }

      if (disableHttp || phoenix) {
        link = wsLink;
      } else {
        link = split( // split based on operation type
        function (_ref3) {
          var query = _ref3.query;

          var _getMainDefinition = getMainDefinition(query),
              kind = _getMainDefinition.kind,
              operation = _getMainDefinition.operation;

          return kind === 'OperationDefinition' && operation === 'subscription';
        }, wsLink, link);
      }
    }
  }

  if (clientState) {
    stateLink = withClientState(_objectSpread({
      cache: cache
    }, clientState));
    link = from([stateLink, link]);
  }

  var apolloClient = new ApolloClient(_objectSpread({
    link: link,
    cache: cache
  }, ssr ? {
    // Set this on the server to optimize queries when SSR
    ssrMode: true
  } : {
    // This will temporary disable query force-fetching
    ssrForceFetchDelay: 100,
    // Apollo devtools
    connectToDevTools: process.env.NODE_ENV !== 'production'
  }, apollo)); // Re-write the client state defaults on cache reset

  if (stateLink) {
    apolloClient.onResetStore(stateLink.writeDefaults);
  }

  return {
    apolloClient: apolloClient,
    wsClient: wsClient,
    stateLink: stateLink
  };
}
export function restartWebsockets(wsClient) {
  // Copy current operations
  var operations = Object.assign({}, wsClient.operations); // Close connection

  wsClient.close(true); // Open a new one

  wsClient.connect(); // Push all current operations to the new connection

  Object.keys(operations).forEach(function (id) {
    wsClient.sendMessage(id, MessageTypes.GQL_START, operations[id].options);
  });
}

function defaultGetAuth(tokenName) {
  // get the authentication token from local storage if it exists
  var token = localStorage.getItem(tokenName); // return the headers to the context so httpLink can read them

  return token ? "Bearer ".concat(token) : '';
}