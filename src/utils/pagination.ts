import type { Request } from 'express'
import type { Model } from 'mongoose'
import { z } from 'zod'

// Zod schema for validating pagination query parameters
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

interface PaginationResult<T> {
  data: T[]
  meta: {
    totalItems: number
    totalPage: number
    currentPage: number
    itemsPerPage: number
  }
}

/**
 * A Utility to apply pagination to a Mongoose query.
 * @param model The Mongoose model to query.
 * @param req The Express request object to get query params from.
 * @param filters Optional filters to apply to the query.
 */

export async function paginate<T>(
  model: Model<T>,
  req: Request,
  filters: object = {},
): Promise<PaginationResult<T>> {
  const { page, limit } = paginationSchema.parse(req.query)

  const skip = (page - 1) * limit

  // Execute queries in parallel for efficiency
  const [data, totalItems] = await Promise.all([
    model.find(filters).skip(skip).limit(limit).select('-password').exec(),
    model.countDocuments(filters),
  ])

  const totalPage = Math.ceil(totalItems / limit)

  return {
    data,
    meta: {
      totalItems,
      totalPage,
      currentPage: page,
      itemsPerPage: limit,
    },
  }
}
