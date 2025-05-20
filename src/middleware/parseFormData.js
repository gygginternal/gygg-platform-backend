// parse a json field from form data
export function parseJsonFields(fields = []) {
  return (req, res, next) => {
    fields.forEach((field) => {
      if (req.body[field] && typeof req.body[field] === "string") {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch (err) {
          return res.status(400).json({ error: `Invalid JSON in ${field}` });
        }
      }
    });
    next();
  };
}
