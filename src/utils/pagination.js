// ============================================================
// utils/pagination.js
// Shared pagination utility used by all list endpoints.
//
// Design decisions:
//   - Default page size is 20.
//   - Maximum page size is capped at 100 to prevent abuse.
//   - Returns both the skip/limit values for the DB query
//     AND the metadata shape for the API response.
//   - Services call buildPaginationQuery(); controllers call
//     buildPaginationMeta() to construct the response.
// ============================================================

const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 100

/**
 * Parses and normalizes page/limit from query params.
 * Returns skip and limit values ready for Mongoose queries.
 *
 * @param {Object} query - req.query
 * @param {string} [query.page]
 * @param {string} [query.limit]
 * @returns {{ page: number, limit: number, skip: number }}
 */
export const buildPaginationQuery = (query = {}) => {
  const page  = Math.max(1, parseInt(query.page, 10)  || 1)
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT)
  )
  const skip = (page - 1) * limit

  return { page, limit, skip }
}

/**
 * Builds the pagination metadata block for API responses.
 *
 * @param {Object} params
 * @param {number} params.total  - total document count for the query
 * @param {number} params.page   - current page number
 * @param {number} params.limit  - items per page
 * @returns {{ total: number, page: number, limit: number, totalPages: number }}
 */
export const buildPaginationMeta = ({ total, page, limit }) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
})
