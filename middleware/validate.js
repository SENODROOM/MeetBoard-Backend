const { ZodError } = require("zod");

/**
 * Express middleware that validates req.body against a Zod schema.
 * On success: replaces req.body with the parsed/defaulted value and calls next().
 * On failure: returns 400 with the first validation error message.
 *
 * Usage:
 *   const validate = require('./middleware/validate');
 *   const schemas  = require('./schemas/classroom');
 *   router.post('/', validate(schemas.createClassroom), handler);
 */
module.exports = function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.errors[0];
        const field = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
        return res.status(400).json({ error: `${field}${first.message}` });
      }
      next(err);
    }
  };
};
