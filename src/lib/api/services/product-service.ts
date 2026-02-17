/**
 * OPS Web - Product Service
 *
 * CRUD operations for the Products/Services catalog.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleFinancialTypes,
  BubbleProductFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type ProductDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  productDtoToModel,
  productModelToDto,
} from "../../types/dto";
import type { Product } from "../../types/models";

export const ProductService = {
  async fetchProducts(
    companyId: string,
    activeOnly: boolean = true
  ): Promise<Product[]> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleProductFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleProductFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (activeOnly) {
      constraints.push({
        key: BubbleProductFields.active,
        constraint_type: BubbleConstraintType.equals,
        value: true,
      });
    }

    const allProducts: Product[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const response = await client.get<BubbleListResponse<ProductDTO>>(
        `/obj/${BubbleFinancialTypes.product.toLowerCase()}`,
        {
          params: {
            constraints: JSON.stringify(constraints),
            limit: 100,
            cursor,
          },
        }
      );

      allProducts.push(...response.response.results.map(productDtoToModel));
      remaining = response.response.remaining;
      cursor += response.response.results.length;
    }

    return allProducts;
  },

  async fetchProduct(id: string): Promise<Product> {
    const client = getBubbleClient();
    const response = await client.get<BubbleObjectResponse<ProductDTO>>(
      `/obj/${BubbleFinancialTypes.product.toLowerCase()}/${id}`
    );
    return productDtoToModel(response.response);
  },

  async createProduct(
    data: Partial<Product> & { name: string; companyId: string }
  ): Promise<string> {
    const client = getBubbleClient();
    const dto = productModelToDto(data);
    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleFinancialTypes.product.toLowerCase()}`,
      dto
    );
    return response.id;
  },

  async updateProduct(id: string, data: Partial<Product>): Promise<void> {
    const client = getBubbleClient();
    const dto = productModelToDto(data);
    await client.patch(
      `/obj/${BubbleFinancialTypes.product.toLowerCase()}/${id}`,
      dto
    );
  },

  async deleteProduct(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.product.toLowerCase()}/${id}`,
      { [BubbleProductFields.deletedAt]: new Date().toISOString() }
    );
  },
};
