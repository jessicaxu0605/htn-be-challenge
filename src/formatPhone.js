// standardize all phone numbers into +1-000-000-0000x... format
function formatPhone(phoneRaw) {
  // isolate country code
  let countryCode;
  if (phoneRaw.includes("+")) {
    const isolateCode = phoneRaw.split("+"); // isolateCode[1] will contain string immediately after the + indicator, even if indicator is not first character in string
    countryCode = parseInt(isolateCode[1]); // assuming the country code is separated from rest of number by a non-digit character
    // remove country code from string
    phoneRaw = isolateCode[1];
    phoneRaw = phoneRaw.replace(countryCode.toString(), "");
  } else {
    countryCode = 1;
  }
  // isolate extension
  let extension;
  if (phoneRaw.includes("x")) {
    const isolateExtension = phoneRaw.split("x"); // isolateCode[1] will contain string immediately after the x indicator, assuming "x" only appears before the extension
    extension = "x" + isolateExtension[1]; //assume exension is very last part of string

    phoneRaw = isolateExtension[0]; // remove country code from string
  } else {
    extension = ""; // no extension
  }
  // isolate rest of phone number
  let mainNumber = phoneRaw.replace(/\D/g, ""); // remove non-number characters

  const phoneFomatted =
    "+" +
    countryCode.toString() +
    "-" +
    mainNumber.slice(0, 3) +
    "-" +
    mainNumber.slice(3, 6) +
    "-" +
    mainNumber.slice(6, 10) +
    extension;
  return phoneFomatted;
}

module.exports = formatPhone;
