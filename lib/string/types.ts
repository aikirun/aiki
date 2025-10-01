export type BrandedString<Brand extends string> = string & {
    _brand: Brand;
}