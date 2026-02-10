declare module "amadeus" {
  interface AmadeusOptions {
    clientId: string;
    clientSecret: string;
    hostname?: "production" | "test";
  }

  interface AmadeusResponse {
    data: any;
    result: any;
    statusCode: number;
  }

  class Amadeus {
    constructor(options: AmadeusOptions);
    shopping: {
      flightOffersSearch: {
        get(params: Record<string, any>): Promise<AmadeusResponse>;
        post(body: string): Promise<AmadeusResponse>;
      };
      flightDates: {
        get(params: Record<string, any>): Promise<AmadeusResponse>;
      };
      hotelOffersSearch: {
        get(params: Record<string, any>): Promise<AmadeusResponse>;
      };
    };
    referenceData: {
      locations: {
        get(params: Record<string, any>): Promise<AmadeusResponse>;
        hotels: {
          byCity: {
            get(params: Record<string, any>): Promise<AmadeusResponse>;
          };
          byGeocode: {
            get(params: Record<string, any>): Promise<AmadeusResponse>;
          };
        };
      };
    };
  }

  export default Amadeus;
}
