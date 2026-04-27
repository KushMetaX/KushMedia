'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  getBrandColors,
  getBrandAsset,
  getDogImage,
  getInscriptionRecord
} = require('../services/doginal-dogs');

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

router.use(apiLimiter);

function asyncRoute(handler) {
  return function wrappedHandler(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseDogNumber(rawValue) {
  const normalized = String(rawValue || '').trim();

  if (!/^\d+$/.test(normalized)) {
    throw createInputError('Invalid inscription number. Enter a whole number between 1 and 10000.');
  }

  const dogNumber = Number.parseInt(normalized, 10);

  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    throw createInputError('Invalid inscription number. Enter a whole number between 1 and 10000.');
  }

  return dogNumber;
}

router.get('/brand-colors', asyncRoute(async (request, response) => {
  const brandColors = await getBrandColors();

  response.set('Cache-Control', 'public, max-age=3600');
  response.json({
    ok: true,
    data: brandColors
  });
}));

router.get('/inscription/:number', asyncRoute(async (request, response) => {
  const dogNumber = parseDogNumber(request.params.number);
  const record = await getInscriptionRecord(dogNumber);

  response.set('Cache-Control', 'public, max-age=300');
  response.json({
    ok: true,
    usedFallback: record.source === 'fallback',
    message: record.message,
    data: record
  });
}));

router.get('/image/:number', asyncRoute(async (request, response) => {
  const dogNumber = parseDogNumber(request.params.number);
  const image = await getDogImage(dogNumber);

  response.set('Cache-Control', 'public, max-age=3600');
  response.type(image.contentType);
  response.send(image.buffer);
}));

router.get('/brand-asset/:name', asyncRoute(async (request, response) => {
  const asset = await getBrandAsset(request.params.name);

  response.set('Cache-Control', 'public, max-age=3600');
  response.type(asset.contentType);
  response.send(asset.buffer);
}));

router.use((error, request, response, next) => {
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500
    ? 'Unable to generate the nail design right now.'
    : error.message;

  response.status(statusCode).json({
    ok: false,
    message
  });
});

module.exports = router;
