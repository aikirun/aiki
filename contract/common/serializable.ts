export type ValidPayload =
    | null
    | string
    | number
    | boolean
    | { [key: string]: ValidPayload } 
    | ValidPayload[];