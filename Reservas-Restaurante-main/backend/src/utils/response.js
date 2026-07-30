exports.ok = (res, message, data = {}, status = 200) => res.status(status).json({
  success: true,
  message,
  data,
  errors: [],
  request_id: res.req?.id,
});

exports.fail = (res, message, errors = [], status = 400) => res.status(status).json({
  success: false,
  message,
  data: {},
  errors,
  request_id: res.req?.id,
});
