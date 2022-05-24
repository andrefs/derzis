module.exports = {
  components: {
    schemas: {
      // process model
      Process: {
        type: "object",
        properties: {
          pid: {
            type: "string",
            description: "Process ID",
            example: "2021-10-15-0",
          },
          notification: {
            type: "object",
            properties: {
              email: {
                type: "string",
                description: "Email address to send status updates",
                example: "alice@example.org"
              },
              webhook: {
                type: "string",
                description: "A URL to be called when the process status changes",
                example: "http://example.org/my-process/callback",
              },
              ssePath: {
                type: "string",
                description: "A
              }
          },
          description: {
            type: "string",
            description: "A description of the crawling process",
            example: "Portuguese largest cities",
          },
          seeds: {
            type: "array",
            items: {
              type: "string",
              description: "Seed resources for the crawling process",
              example: "https://dbpedia.org/resource/Lisbon",
            }
          },
          params: {
            type: "object",
            properties: {
              maxPathLength: {
                type: "number",
                description: "Maximum number of nodes for a path",
                example: 3,
              },
              maxPathProps: {
                type: "number",
                description: "Maximum number of different properties for a path",
                example: 2
              }
            },
          },
          status: {
            type: "boolean", // data type
            description: "The status of the todo", // desc
            example: false, // example of a completed value
          },
          description: {
            type: "boolean", // data type
            description: "The status of the todo", // desc
            example: false, // example of a completed value
          },
        },
      },
      // Todo input model
      TodoInput: {
        type: "object", // data type
        properties: {
          title: {
            type: "string", // data type
            description: "Todo's title", // desc
            example: "Coding in JavaScript", // example of a title
          },
          completed: {
            type: "boolean", // data type
            description: "The status of the todo", // desc
            example: false, // example of a completed value
          },
        },
      },
      // error model
      Error: {
        type: "object", //data type
        properties: {
          message: {
            type: "string", // data type
            description: "Error message", // desc
            example: "Not found", // example of an error message
          },
          internal_code: {
            type: "string", // data type
            description: "Error internal code", // desc
            example: "Invalid parameters", // example of an error internal code
          },
        },
      },
    },
  },
};
