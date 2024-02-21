const express = require("express");
const mysql = require("mysql");
const dotenv = require("dotenv");
const formatPhone = require("./formatPhone");

const app = express();
app.use(express.json());

const port = 3600;
dotenv.config();
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugin: "mysql_native_password",
});

// helper function to aid async/await functions
function executeQuery(query) {
  return new Promise((resolve, reject) => {
    console.log(query);
    pool.query(query, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

//---------------------- USERS ENDPOINTS ----------------------//

// function is shared by single user and all user endpoints
async function getUsers(query) {
  try {
    const result = await executeQuery(query);

    const users = result.map((user) => {
      let skills; // skills are recieved as a comma separated list
      // convert them into an array, in the same format as the provided user data
      if (user.skill_names) {
        const skill_names = user.skill_names.split(",");
        const ratings = user.ratings.split(",");
        skills = skill_names.map((skill_name, index) => ({
          skill: skill_name,
          rating: ratings[index],
        }));
      } else {
        skills = []; // if user has no skills, return an empty array
      }

      return {
        id: user.user_id, //sending id as well, in case client wants to fetch data for specific user
        name: user.name,
        company: user.company,
        email: user.email,
        phone: user.phone,
        skills: skills,
      };
    });

    return users;
  } catch (err) {
    throw err;
  }
}

app.get("/users", async (req, res) => {
  // NOTE: left join on users_to_skills in case user has no skills :(
  const query = `
    SELECT u.user_id, u.name, u.company, u.email, u.phone, 
      GROUP_CONCAT(u2s.skill_name ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS skill_names,
      GROUP_CONCAT(u2s.rating ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS ratings
    FROM htn_be_db.users u
    LEFT JOIN htn_be_db.users_to_skills u2s ON u2s.user_id = u.user_id
    GROUP BY u.user_id`;
  try {
    const users = await getUsers(query);
    res.send(users);
  } catch (err) {
    res.status(500).send({ error: "internal server error" });
  }
});

app.get("/users/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  // NOTE: left join on users_to_skills in case user has no skills :(
  const query = mysql.format(
    `
    SELECT u.user_id, u.name, u.company, u.email, u.phone, 
      GROUP_CONCAT(u2s.skill_name ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS skill_names,
      GROUP_CONCAT(u2s.rating ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS ratings
    FROM htn_be_db.users u
    LEFT JOIN htn_be_db.users_to_skills u2s ON u2s.user_id = u.user_id
    WHERE u.user_id = ?
    GROUP BY u.user_id
    LIMIT 1`,
    [user_id]
  );
  try {
    const users = await getUsers(query);
    res.send(users[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// function is used by PUT user endpoint to update the users table
async function updateUser(user_id, user) {
  let userQueryString = `
    UPDATE htn_be_db.users SET 
      name = CASE WHEN ? THEN ? ELSE name END,
      company = CASE WHEN ? THEN ? ELSE company END,
      email = CASE WHEN ? THEN ? ELSE email END,
      phone = CASE WHEN ? THEN ? ELSE phone END
    WHERE user_id = ?`;
  const userQueryParams = [
    user.name ? true : false,
    user.name,
    user.company ? true : false,
    user.company,
    user.email ? true : false,
    user.email,
    user.phone ? true : false,
    user.phone ? formatPhone(user.phone) : null,
    user_id,
  ];
  const userQuery = mysql.format(userQueryString, userQueryParams);
  try {
    await executeQuery(userQuery);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function updateChangedRatings(user_id, changedRatings) {
  if (changedRatings.length > 0) {
    //update rating column in users_to_skills table
    await executeQuery(
      mysql.format(
        `
        UPDATE htn_be_db.users_to_skills
          SET rating =
            CASE skill_name
              ${changedRatings
                .map((skill) => `WHEN '${skill.skill}' THEN ${skill.rating}`)
                .join(" ")}
              ELSE rating
            END
        WHERE user_id = ?;`,
        [user_id]
      )
    );
  }
}

async function updateLearnedSkills(user_id, learnedSkills) {
  if (learnedSkills.length > 0) {
    // update skills table -- do this first in case skill is not in skills table yet
    const skillsInsertValues = learnedSkills.map((skill) => [skill.skill, 1]);
    await executeQuery(
      mysql.format(
        `
          INSERT INTO htn_be_db.skills (skill_name, frequency) 
            VALUES ?
            ON DUPLICATE KEY UPDATE frequency = frequency + 1;`,
        [skillsInsertValues]
      )
    );
    // update users_to_skills table
    const users_to_skillsInsertValues = learnedSkills.map((skill) => [
      user_id,
      skill.skill,
      skill.rating,
    ]);
    await executeQuery(
      mysql.format(
        `
          INSERT IGNORE INTO htn_be_db.users_to_skills (user_id, skill_name, rating) 
            VALUES ?`,
        [users_to_skillsInsertValues]
      )
    );
  }
}

async function updateLostSkills(user_id, lostSkills) {
  if (lostSkills.length > 0) {
    // update users_to_skills table
    await executeQuery(
      mysql.format(
        `
          DELETE FROM htn_be_db.users_to_skills  
            WHERE user_id = ? AND skill_name IN (?)`,
        [user_id, lostSkills.map((skill) => skill.skill_name)]
      )
    );
    // decrement frequency in skills table
    // if this makes a skill's frequency reach 0, leave it in the table--it doesn't make a huge difference to remove it
    await executeQuery(
      mysql.format(
        `
          UPDATE htn_be_db.skills  
          SET frequency = frequency - 1
          WHERE skill_name IN (?)`,
        [lostSkills.map((skill) => skill.skill_name)]
      )
    );
  }
}

// assumptions:
// if the "skills" property is included in the put request body, whatever contents are associated with the property
// are to replace the original "skills" in its entirety
// again, duplicate skills (non-unique combination of user, skill, and rating) are ignored
async function updateSkills(user_id, updated_skills) {
  // NOTE: this function not very efficient, but since the challenge description indicates it is rarely be executed, this should not be a problem
  let prev_skills;
  try {
    prev_skills = await executeQuery(
      mysql.format(
        "SELECT skill_name, rating FROM htn_be_db.users_to_skills WHERE user_id = ?",
        [user_id]
      )
    );
    const updated_skill_names = updated_skills.map((skill) => skill.skill); // note: incoming data has skill_name field under "skill"
    const prev_skill_names = prev_skills.map((skill) => skill.skill_name);

    // user already has skill, only rating changed (or no change at all)
    const changedRatings = updated_skills.filter((updated_skill) =>
      prev_skill_names.includes(updated_skill.skill)
    );
    await updateChangedRatings(user_id, changedRatings);

    // skills user did not previously have
    const learnedSkills = updated_skills.filter(
      (updated_skill) => !prev_skill_names.includes(updated_skill.skill)
    );
    await updateLearnedSkills(user_id, learnedSkills);

    // skills user previously had, but no longer has on update
    const lostSkills = prev_skills.filter(
      (prev_skill) => !updated_skill_names.includes(prev_skill.skill_name)
    );
    await updateLostSkills(user_id, lostSkills);
  } catch (err) {
    throw err;
  }
}

// assume req body is valid
app.put("/users/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  if (!user_id) {
    res.status(400).send({ error: "User ID is required" });
    return;
  }
  try {
    // update fields
    await updateUser(user_id, req.body);
    if (req.body.skills) {
      await updateSkills(user_id, req.body.skills);
    }

    // get user data once everything has been updated
    const getUserQuery = mysql.format(
      `
    SELECT u.user_id, u.name, u.company, u.email, u.phone, 
      GROUP_CONCAT(u2s.skill_name ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS skill_names,
      GROUP_CONCAT(u2s.rating ORDER BY u2s.skill_name ASC SEPARATOR ', ') AS ratings
    FROM htn_be_db.users u
    LEFT JOIN htn_be_db.users_to_skills u2s ON u2s.user_id = u.user_id
    WHERE u.user_id = ?
    GROUP BY u.user_id
    LIMIT 1`,
      [user_id]
    );
    const users = await getUsers(getUserQuery);
    res.send(users[0]); // return updated data
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

//---------------------- SKILLS ENDPOINTS ----------------------//

app.get("/skills", async (req, res) => {
  const min_frequency = req.query.min_frequency; // if min_frequency is specified, add a lower bound
  const max_frequency = req.query.max_frequency; // if max_frequency is specified, add an upper bound
  let getSkillsQuery;
  if (min_frequency && max_frequency) {
    getSkillsQuery = mysql.format(
      "SELECT * FROM htn_be_db.skills WHERE frequency BETWEEN ? AND ? ORDER BY frequency",
      [min_frequency, max_frequency]
    );
  } else if (min_frequency) {
    getSkillsQuery = mysql.format(
      "SELECT * FROM htn_be_db.skills WHERE frequency > ? ORDER BY frequency",
      [min_frequency]
    );
  } else if (max_frequency) {
    getSkillsQuery = mysql.format(
      "SELECT * FROM htn_be_db.skills WHERE frequency < ? ORDER BY frequency",
      [max_frequency]
    );
  } else {
    getSkillsQuery = "SELECT * FROM htn_be_db.skills ORDER BY frequency";
  }

  try {
    const skills = await executeQuery(getSkillsQuery);
    res.send(skills);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

//---------------------- ADDITIONAL ENDPOINTS ----------------------//

app.get("/users-by-skill/:skill", async (req, res) => {
  //assume param value is in lowercase, with spaces replaced by - (eg. django-rest-framwork)
  const skill_name = req.params.skill;
  try {
    const users = await executeQuery(
      mysql.format(
        `
          SELECT u.user_id, name, company, email, rating FROM htn_be_db.users u
            JOIN htn_be_db.users_to_skills u2s ON u.user_id = u2s.user_id
            WHERE LOWER(skill_name)=LOWER(?)
            ORDER BY rating DESC
            `,
        [skill_name.replaceAll("-", " ")]
      )
    );
    res.send(users);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

//---------------------- HARDWARE CHECKOUT ----------------------//

//get all hardware
app.get("/hardware", async (req, res) => {
  try {
    const hardware = await executeQuery(
      mysql.format(`SELECT * FROM htn_be_db.hardware`)
    );
    res.send(hardware);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

//get one entry in the hardware table
app.get("/hardware/:item_id", async (req, res) => {
  const item_id = req.params.item_id;
  try {
    const hardware = await executeQuery(
      mysql.format(
        `
        SELECT * FROM htn_be_db.hardware WHERE item_id=? LIMIT 1`,
        [item_id]
      )
    );
    res.send(hardware[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// create a checkout transaction
app.post("/hardware-checkout", async (req, res) => {
  const item_id = req.body.item_id;
  const user_id = req.body.user_id; // user that checked out the item
  if (!item_id) {
    res.status(400).send({ error: "item_id is required" });
    return;
  }
  if (!user_id) {
    res.status(400).send({ error: "user_id is required" });
    return;
  }
  try {
    //check if item is available
    const result = await executeQuery(
      mysql.format(
        `SELECT quantity_available FROM htn_be_db.hardware 
        WHERE item_id=? LIMIT 1`,
        [item_id]
      )
    );
    if (result.length === 0) {
      res.status(404).send({ error: "item requested does not exist" });
      return;
    } else if (result[0].quantity_available < 1) {
      res.send("selected hardware item is unavailable right now");
      return;
    }

    // decrement available quantity
    await executeQuery(
      mysql.format(
        `
        UPDATE htn_be_db.hardware
          SET quantity_available = quantity_available - 1
          WHERE item_id=?
        `,
        [item_id]
      )
    );

    // add a transaction
    await executeQuery(
      mysql.format(
        `
        INSERT INTO htn_be_db.hardware_transactions (item_id, user_id, checkout_date)
          VALUES (?, ?, NOW())
        `,
        [item_id, user_id]
      )
    );

    // send the transaction record back to the client
    const transaction = await executeQuery(
      `SELECT * FROM htn_be_db.hardware_transactions WHERE transaction_id = LAST_INSERT_ID() LIMIT 1;`
    );
    res.send(transaction[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

app.put("/hardware-return", async (req, res) => {
  const transaction_id = req.body.transaction_id;
  if (!transaction_id) {
    res.status(400).send({ error: "transaction_id is required" });
    return;
  }
  try {
    // check that item has not already been returned, and that transaction exists
    const result = await executeQuery(
      mysql.format(
        `
        SELECT return_date FROM htn_be_db.hardware_transactions 
            WHERE transaction_id = ?
        `,
        [transaction_id]
      )
    );
    if (result.length === 0) {
      res.status(404).send({ error: "transaction does not exist" });
      return;
    } else if (result[0].return_date != null) {
      res.status(400).send({ error: "item has already been returned" });
      return;
    }

    // increment available quantity
    await executeQuery(
      mysql.format(
        `
        UPDATE htn_be_db.hardware
          SET quantity_available = quantity_available + 1
          WHERE item_id= (
            SELECT item_id FROM htn_be_db.hardware_transactions 
            WHERE transaction_id = ?)
        `,
        [transaction_id]
      )
    );
    // add return date to transaction
    await executeQuery(
      mysql.format(
        `
        UPDATE htn_be_db.hardware_transactions SET return_date = NOW() WHERE transaction_id = ?`,
        [transaction_id]
      )
    );

    // send transaction to client
    const transaction = await executeQuery(
      mysql.format(
        `SELECT * FROM htn_be_db.hardware_transactions WHERE transaction_id = ?;`,
        [transaction_id]
      )
    );
    res.send(transaction[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// get all transactions
app.get("/transaction-history", async (req, res) => {
  try {
    const transactions = await executeQuery(
      `SELECT * FROM htn_be_db.hardware_transactions 
      ORDER BY return_date` // orders by most recent, AND ensures null return dates appear first
    );
    res.send(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// get transactions made by a specified user
app.get("/transaction-history/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  try {
    const transactions = await executeQuery(
      mysql.format(
        `
        SELECT * FROM htn_be_db.hardware_transactions WHERE user_id=? 
        ORDER BY return_date`, // orders by most recent, AND ensures null return dates appear first
        [user_id]
      )
    );
    res.send(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Listening... at port ${port}`);
});
