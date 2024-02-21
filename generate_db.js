const mysql = require("mysql");
const fs = require("fs");
const formatPhone = require("./src/formatPhone");

// set these connections as necessary to access local mysql server
// ensure authenticaton type is Standard (mysql_native_password), not caching_sha2_password
// ensure user has admin privileges to create users, grant option, access to all databases (including the newly created one)
const connection = mysql.createConnection({
  host: "localhost",
  user: "nodeaccess",
  password: "20940f9$3F30f",
  authPlugin: "mysql_native_password",
});
connection.connect();

const username = "htn_be_admin";
const host = "localhost";
const password = "not-a-good-password";
const dbName = "htn_be_db";

function executeQuery(query) {
  return new Promise((resolve, reject) => {
    connection.query(query, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

async function createUserAndDatabase() {
  try {
    await executeQuery(
      `CREATE USER '${username}'@'${host}' IDENTIFIED WITH mysql_native_password BY '${password}';`
    );
    await executeQuery(`CREATE DATABASE ${dbName};`);
    await executeQuery(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${dbName}.* TO '${username}'@'${host}';`
    );
  } catch (err) {
    throw err;
  }
}

async function createTables() {
  try {
    await executeQuery(
      // user_id as primary key (just in case there are repeating values in other fields)
      `CREATE TABLE ${dbName}.users (
        user_id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL,
        company VARCHAR(100) NOT NULL,
        email VARCHAR(50) NOT NULL,
        phone VARCHAR(25) NOT NULL,
        PRIMARY KEY (user_id));`
    );
    await executeQuery(
      `CREATE TABLE ${dbName}.skills (
        skill_name VARCHAR(50) NOT NULL,
        frequency INT NOT NULL DEFAULT 0,
        PRIMARY KEY (skill_name));`
    );
    await executeQuery(
      // compound primary key--each entry should have a unique combination of user and skill
      `CREATE TABLE ${dbName}.users_to_skills (
        user_id INT,
        skill_name VARCHAR(50),
        rating INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES htn_be_db.users(user_id),
        FOREIGN KEY (skill_name) REFERENCES htn_be_db.skills(skill_name),
        PRIMARY KEY (user_id, skill_name));`
    );

    // tables for hardware checkout feature:
    await executeQuery(
      `CREATE TABLE ${dbName}.hardware (
        item_id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL,
        quantity_available INT NOT NULL,
        PRIMARY KEY (item_id));`
    );
    await executeQuery(
      `CREATE TABLE ${dbName}.hardware_transactions (
        transaction_id INT NOT NULL AUTO_INCREMENT,
        item_id INT NOT NULL,
        user_id INT NOT NULL,
        checkout_date DATETIME NOT NULL DEFAULT NOW(),
        return_date DATETIME DEFAULT NULL,
        FOREIGN KEY (item_id) REFERENCES htn_be_db.hardware(item_id),
        FOREIGN KEY (user_id) REFERENCES htn_be_db.users(user_id),
        PRIMARY KEY (transaction_id));`
    );
  } catch (err) {
    throw err;
  }
}

async function processOneUser(user) {
  try {
    const phoneFormatted = formatPhone(user.phone);
    // add user
    await executeQuery(
      mysql.format(
        `INSERT INTO ${dbName}.users (name, company, email, phone) 
      VALUES(?, ?, ?, ?);`,
        [user.name, user.company, user.email, phoneFormatted]
      )
    );
    const result = await executeQuery(`SELECT LAST_INSERT_ID();`);
    const newUserID = result[0]["LAST_INSERT_ID()"];

    //add skills
    const skillsInsertValues = user.skills.map((skill) => [skill.skill, 1]);
    await executeQuery(
      mysql.format(
        `INSERT INTO ${dbName}.skills (skill_name, frequency) 
        VALUES ?
        ON DUPLICATE KEY UPDATE frequency = frequency + 1;`,
        [skillsInsertValues]
      )
    );

    // add users_to_skills mapping
    const users_to_skillsInsertValues = user.skills.map((skill) => [
      newUserID,
      skill.skill,
      skill.rating,
    ]);
    await executeQuery(
      mysql.format(
        `INSERT IGNORE INTO ${dbName}.users_to_skills (user_id, skill_name, rating) 
        VALUES ?;`,
        [users_to_skillsInsertValues]
      )
    );
  } catch (err) {
    throw err;
  }
}

function generateUserEntries() {
  return new Promise((resolve, reject) => {
    fs.readFile("src/HTN_2023_BE_Challenge_Data.json", async (err, data) => {
      if (err) throw err;

      try {
        const userData = JSON.parse(data);
        for (const user of userData) {
          await processOneUser(user); // await just in case to avoid conflicts with LAST_INSERT_ID
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

function generateHardwareEntries() {
  return new Promise((resolve, reject) => {
    fs.readFile("src/hardware_data.json", async (err, data) => {
      if (err) throw err;
      try {
        const hardwareData = JSON.parse(data);
        await executeQuery(
          mysql.format(
            `INSERT INTO ${dbName}.hardware (name, quantity_available) 
            VALUES ?;`,
            [hardwareData.map((item) => [item.name, item.quantity])]
          )
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

function generateDotenvCredentials() {
  // to be used by the server
  // these credentials are only exposed for the convenience of anyone trying out this project submission
  const envContent = `DB_HOST=localhost
    DB_USER=htn_be_admin
    DB_PASSWORD=not-a-good-password
    DB_NAME=htn_be_db
    DB_PORT=3306
    `;

  fs.writeFileSync(".env", envContent);
}

async function generateDB() {
  try {
    await createUserAndDatabase();
    await createTables();
    await generateUserEntries();
    await generateHardwareEntries();
    generateDotenvCredentials();
  } catch (err) {
    throw err;
  } finally {
    console.log("generation complete");
    connection.end();
  }
}

console.log("generating...");
generateDB();
