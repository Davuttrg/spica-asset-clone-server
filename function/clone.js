/*

What can this do ?
    * Clone your buckets schemas with same _id between your spica servers
    * Clone your functions with dependencies and environments between your spica servers

The process of this asset works as follows: Suppose the main server is A and B's cloning server. You must download this asset for both of these servers. 

    You should call the 'sender' function with Post method to A
        Body 
            {
                server_name -> Required! Your functions, dependencies of functions and buckets schemas will send to B
                (accepted : server_name for example "test-a1b2c")

                unwanted_buckets -> if it is empty or  '*' then  your all buckets will send to B
                (accepted : * , with commas next to bucket id for example "bucket_id,bucket_id" or emtpy)

                environments -> if it is empty or  'true' then  your functions will send with environments to B
                (accepted : true , false or emtpy)
            }
You must raise the function maximum timeout up to 300 seconds from the Hq dashboard panel (advance settings)

*/

import * as Bucket from "@spica-devkit/bucket";
const fetch = require("node-fetch");
import { database, close, ObjectId } from "@spica-devkit/database";

export async function sender(req, res) {
    const { unwanted_buckets, environments, server_name } = req.body;
    Bucket.initialize({ apikey: `${process.env.API_KEY}` });
    const HOST = req.headers.get("host");
    let spesificSchema = false;

    /////////--------------Get Schemas-----------------////////////
    let schemas = await Bucket.getAll().catch(error =>
        console.log("get all buckets error :", error)
    );
    if (unwanted_buckets && unwanted_buckets != "*") {
        schemas = schemas.filter(schema => JSON.stringify(unwanted_buckets).indexOf(schema._id) == -1);
        spesificSchema = true;
    }
    /////////--------------Get Schemas-----------------////////////

    /////////--------------Get Functions with dependencies and environments-----------------////////////
    let allFunctions = await getAllFunctions(HOST).catch(error =>
        console.log("get allfunctions error :", error)
    );


    let isIgnore = false;
    let willSpliceIndex;
    for (let [index, fn] of allFunctions.entries()) {
        isIgnore = false;
        Object.keys(fn.env).forEach(e => {
            if (e == "_IGNORE_") {
                isIgnore = true;
                willSpliceIndex = index;
                return;
            }
        });
        if (!isIgnore) {
            await getIndexes(fn._id, HOST)
                .then(index => {
                    fn.index = index;
                })
                .catch(error => console.log("getIndexes error :", error));
            await getDependencies(fn._id, HOST)
                .then(dependency => {
                    fn.dependencies = dependency;
                })
                .catch(error => console.log("getDependencies error :", error));
        }
    }
    allFunctions.splice(willSpliceIndex, 1);
    /////////--------------Get Functions with dependencies and environments-----------------////////////


    await fetch(`https://${server_name}.hq.spicaengine.com/api/fn-execute/receiver`, {
        method: "post",
        body: JSON.stringify({
            data: {
                schemas: schemas,
                allFunctions: allFunctions,
                spesificSchema: spesificSchema,
                env: !environments || environments == true ? true : false
            }
        }),
        headers: { "Content-Type": "application/json" }
    })
        .then(_ => {
            return res.status(200).send({ message: "Ok" });
        })
        .catch(error => {
            console.log("error : ", error);
            return res.status(400).send({ message: error });
        });
}

async function getAllFunctions(HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}
async function getIndexes(id, HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/${id}/index`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}
async function getDependencies(id, HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/${id}/dependencies`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}
async function deleteFunctions(HOST) {
    let isIgnore = false;
    let removeFunctionsPromises = [];
    await getAllFunctions(HOST)
        .then(functions => {
            functions.forEach(f => {
                isIgnore = false;
                Object.keys(f.env).forEach(e => {
                    if (e == "_IGNORE_") {
                        isIgnore = true;
                        return;
                    }
                });
                if (!isIgnore) {
                    removeFunctionsPromises.push(
                        fetch(`https://${HOST}/api/function/${f._id}`, {
                            method: "DELETE",
                            headers: {
                                Authorization: `APIKEY ${process.env.API_KEY}`
                            }
                        })
                    );
                }
            });
        })
        .catch(error => console.log("getAllFunctions error :", error));

    await Promise.all(removeFunctionsPromises).catch(error =>
        console.log("removeFunctionPromises Error : ", error)
    );
}
export async function receiver(req, res) {
    console.log("-----------Clone Start--------------");
    const { data } = req.body;
    const HOST = req.headers.get("host");

    Bucket.initialize({ apikey: `${process.env.API_KEY}` });

    /////////--------------Bucket Operations-----------------////////////
    await bucketOperations(data.schemas)
    /////////--------------Bucket Operations-----------------////////////

    /////////--------------Delete Functions-----------------////////////
    await deleteFunctions(HOST)
    /////////--------------Delete Functions-----------------////////////

    /////////--------------Insert Functions-----------------////////////
    let tempDep;
    let tempIndex;
    for (const func of data.allFunctions) {
        delete func._id;
        tempDep = func.dependencies;
        tempIndex = func.index;
        delete func.index;
        delete func.dependencies;
        if (!data.env) func.env = {};
        console.log(func.name + " function inserting");
        await fetch(`https://${HOST}/api/function`, {
            method: "post",
            body: JSON.stringify(func),
            headers: {
                "Content-Type": "application/json",
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                /////////--------------Insert Index-----------------////////////
                if (tempIndex.index) {
                    await fetch(`https://${HOST}/api/function/${json._id}/index`, {
                        method: "post",
                        body: JSON.stringify(tempIndex),

                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `APIKEY ${process.env.API_KEY}`
                        }
                    });
                }
                /////////--------------Insert Index-----------------////////////

                /////////--------------Insert Dependencies-----------------////////////
                for (const dep of tempDep) {
                    await fetch(`https://${HOST}/api/function/${json._id}/dependencies`, {
                        method: "post",
                        body: JSON.stringify({ name: dep.name + "@" + dep.version }),
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `APIKEY ${process.env.API_KEY}`
                        }
                    });
                }
                /////////--------------Insert Dependencies-----------------////////////

            })
            .catch(error => console.log("error when function insert", error));
    }
    /////////--------------Insert Functions-----------------////////////

    console.log("-----------Clone Done--------------");
    return res.status(200).send({ message: "Ok receiver" });
}

async function bucketOperations(newSchemas) {

    let oldSchemas = await Bucket.getAll();
    const db = await database();
    let collection_buckets = db.collection("buckets");

    let willAdd = [];
    let willRemove = [];
    let willUpdate = [];
    let promises = [];

    newSchemas.forEach(n => {
        let upd_data = oldSchemas.filter(o => o._id == n._id)[0];
        if (upd_data)
            willUpdate.push(n);
        else willAdd.push(n);
    });
    oldSchemas.forEach(o => {
        let upd_data = newSchemas.filter(n => n._id == o._id)[0];
        if (!upd_data) willRemove.push(o);
    });

    console.log("willAdd :", willAdd, "willUpdate : ", willUpdate, "will delete : ", willRemove);

    for (let schema of willAdd) {
        await db.createCollection(`bucket_${schema._id}`)
        schema._id = new ObjectId(schema._id);
        await collection_buckets.insertOne(schema);
    }

    willRemove.forEach(r => { db.dropCollection(`bucket_${r._id}`); promises.push(Bucket.remove(r._id)) });
    willUpdate.forEach(u =>
        promises.push(Bucket.update(u._id, u))
    );


    await Promise.all(promises)
        .then(response => {
            console.log("--ALL PROMISES DONE ", response);
        })
        .catch(error => {
            console.llog(error);
        });
}