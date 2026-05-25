// ============================================================
// middlewares/notFound.middleware.js
// Catches any request that did not match a registered route.
// Registered AFTER all routes, BEFORE error.middleware.js.
// ============================================================

const notFoundMiddleware = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    errors:  [],
    code:    404,
  })
}

export default notFoundMiddleware
